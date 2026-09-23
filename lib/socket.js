const sockets = [];
let io;
const _ = require('lodash');
const cflapi = require("./cflapi.js");
const mongo = require('./cflmongo');
const { currentWeek, getCurrentWeek } = require('./general');
const { resetPassword } = require('./email');
const { commands, schedule$ } = require('./rxjs');


function emit(command, data = {}) {
    _.each(sockets, s => {
        s.socket.emit(command, data);
    })
}

async function sendWaivers(socket, team, req_week = undefined, req_round = undefined) {
    const week = req_week ?? await currentWeek();
    if (week === 1) return;
    const settings = _.find(((await mongo.find('settings')).pop()).weeks, x => x.num === week);
    const round = (!!req_round) ? req_round -1 : (_.filter(settings.moves, move => !!move.length)).length;
    const data =  _.chain(settings.waivers[round])
                        .filter(x => x.team === team && !!x.active)
                        .sortBy('order')
                        .value();
    socket.emit('team-waivers', data);
}

function connect(socket) {
    sockets.push({ owner: null, socket });

    socket.on('update-players', data => {
        if (!data.admin) {
            console.log('You cannot do that!!!');
            return;
        }
        schedule$.next(commands.UPDATEPLAYERS);
    });

    socket.on('do-moves', data => {
        if (!data.admin) {
            console.log('You cannot do that!!!');
            return;
        }
        schedule$.next(commands.MOVES);
    });

    socket.on('live-scoring', async data => {
        // const logos = ['red', 'blue', 'yellow', 'orange', 'green', 'purple'];
        // let logo;
        // for (let _id = 1; _id <= 12; _id++ ) {
        //     logo = logos[_id % 6] + "-helmet.png";
        //     await mongo.update('teams', { query: { _id }, set: { logo }});
        //     console.log(_id, logo);
        // }
        // console.log('teams updated!');
        if (!data.admin) {
            console.log('You cannot do that!!!');
            return;
        }
        schedule$.next(commands.LIVESCORING);
    });

    socket.on('admin-refresh-browsers', data => {
        if (!data.admin) {
            return;
        }
        emit('refresh-browser');
    })

    socket.on('lost-password', async data => {
        const query = { owner_id: data.username };
        const owner = await mongo.find('owners', { query });
        if (!owner.length) {
            return;
        }
        const info = await resetPassword(owner[0]);
        socket.emit('password-request-emailed');
        if (_.includes(info.accepted, owner.alt_email)) {
        }
    });

    socket.on('mark-as-read', async data => {
        const week = (await currentWeek()) - 1;
        const year = 2026;
        const query = { year };
        const addToSet = {};
        addToSet[`weeks.${week}.messageRead`] = data.team;
        await mongo.addToArray('settings', { query, addToSet });
        console.log('mark-as-read', data);
    })

    socket.on('disconnect', s => {
        const index = _.findIndex(sockets, x => x.socket.id === socket.id);
        sockets.splice(index, 1);
    });
    socket.on('login', async data => {
      const owner = await cflapi.login(data.owner_id, data.password);
      if (!!owner.length) {
          const _socket = _.find(sockets, x => x.socket.id === socket.id);
          _socket.owner = owner[0].owner_id;
          socket.emit('login-good', owner[0]);
          sendWaivers(socket, owner[0].team);
      } else {
          socket.emit('login-bad');
      }
    });
    socket.on('logoff', s => {
        const _socket = _.find(sockets, x => x.socket.id === socket.id);
        _socket.owner = null;
    });
    socket.on('activation-claim', async plr => {
        const week = (await currentWeek()) - 1;
        let query = { _id: plr.pu };
        let set = {};
        set[`weeks.${week}.IR`] = false;
        if (!plr.drop) set[`weeks.${week}.cflteam`] = 0;
        mongo.update('players', { query, set });
        if (!!plr.drop) {
            const query2 = { _id: plr.drop };
            const set2 = {};
            if (!!plr.dropToIR) {
                set2[`weeks.${week}.IR`] = true;
            } else {
                set2[`weeks.${week}.cflteam`] = 0;
            }
            mongo.update('players', { query: query2, set: set2 });
        }
        plr.time = new Date().getTime();
        const queryAdd = { year: 2026 };
        const addToSet = {};
        addToSet[`weeks.${week}.activations`] = plr;
        mongo.addToArray('settings', { query: queryAdd, addToSet });
        socket.emit('refresh-all');
    });
    socket.on('waiver-claim', async waiver => {
        const week = await currentWeek();
        const settings = _.find(((await mongo.find('settings')).pop()).weeks, x => x.num === week);
        const moves = settings.moves;
        const waivers = settings.waivers;
        const round = (_.filter(moves, rnd => !!rnd.length)).length;
        const team = _.filter(waivers[round], x => x.team === waiver.team && !!x.active);
        waiver.time = Date.now();
        waiver.order = team.length + 1;
        waiver.active = true;
        waiver.changes = [];
        waivers[round].push(waiver);
        const set = {};
        set[`weeks.${week-1}.waivers.${round}`] = waivers[round];
        await mongo.update('settings', { query: {}, set });
        sendWaivers(socket, waiver.team);
    });

    socket.on('update-waivers', async data => {
        const time = Date.now();
        const week = await currentWeek();
        const settings = _.find(((await mongo.find('settings')).pop()).weeks, x => x.num === week);
        const moves = _.filter(settings.moves, move => !!move.length);
        const waivers = settings.waivers;
        const round = moves.length;
        _.each(data.changes, async waiver => {
            const db = _.find(waivers[round], x => x.time === waiver._id);
            if (!db) return;
            waiver.change.time = time;
            db.changes.push(waiver.change);
            const query = { year: 2026 };
            query[`weeks.${week-1}.waivers.${round}.time`] = waiver._id;
            const set = {};
            if (waiver.change.type === 'move-waiver') {
                set[`weeks.${week-1}.waivers.${round}.$.order`] = waiver.change.to;
            }
            if (waiver.change.type === 'delete-waiver') {
                set[`weeks.${week-1}.waivers.${round}.$.active`] = false;
            }
            set[`weeks.${week-1}.waivers.${round}.$.changes`] = db.changes;
            mongo.update('settings', { query, set });
        });
    });

    socket.on('refresh-waivers', data => {
        sendWaivers(socket, data.team, data.week, data.round);
    });

    socket.on('password-reset-key', async data => {
        console.log('password-reset-key', data);
        const query = { 'reset.key': data.key };
        const owner = await mongo.find('owners', { query });
        let returnData = {};
        if (!!owner.length) {
            const o = owner[0];
            returnData.owner = o.owner_id;
            returnData.expires = (new Date().getTime() > o.reset.expires);
        }
        socket.emit('password-reset-info', returnData);
    });

    socket.on('update-password', async data => {
        const query = { owner_id: data.owner_id };
        const set = {
            password: data.password,
            reset: null
        }
        await mongo.update('owners', { query, set });
        const owner = (await mongo.find('owners', { query }))[0];
        socket.emit('password-change-complete', { owner });
    });

    socket.on('change-team-name', async data => {
        const query = { _id: data.teamId };
        const set = { team_name: data.teamName };
        await mongo.update('teams', { query, set });
        emit('team_name_changed', data);
    })
  }


module.exports = {
    connect(listener) {
        io = require('socket.io')(listener, {
            cors: {
                origin: ["http://cactusfantasy.com", "https://cactusfantasy.com", "http://localhost:4200", "http://www.cactusfantasy.com", "https://www.cactusfantasy.com"],
                methods: ["GET", "POST"],
            }
        });
        io.on('connection', connect);
    },
    allSockets() {
        return _.map(sockets, socket => {
            return socket.owner;
        });
    },
    emit
}