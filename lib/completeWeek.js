// jshint esversion:6

const mongo = require('./cflmongo');
const {
    getCurrentWeek,
    currentWeek,
} = require('./general');
const _ = require('lodash');
const { emit } = require('./socket');
const { schedule$, commands } = require('./rxjs');

async function updateWeek() {
    const wk = await getCurrentWeek();
    if (wk.week === wk.realweek) return;
    const query = {};
    const set = {};
    set[`weeks.${wk.week}.started`] = true;
    await mongo.update('settings', { query, set });
    setTimeout(() => {
        emit("refresh-all");
        schedule$.next(commands.UPDATEPLAYERS);
    }, 10000);

}   

async function getWinners() {
    const wk = await getCurrentWeek();
    if (wk.week === wk.realweek) return;
    const week = wk.week;
    const schedule = await mongo.find('cflschedule', { query: { week }});
    _.each(schedule, async game => {
        const diff = (game.team1.score - game.team2.score) || (game.team1.tiebreaker - game.team2.tiebreaker);
        const winner = (diff < 0) ? game.team2.id : game.team1.id;
        let set = { winner };
        let query = { _id: game._id };
        await mongo.update('cflschedule', { query, set });
    });
    console.log('SCHEDULE UPDATED');
    updateWeek();
}

function sumPlayerStats(weeks, stats) {
    let score = 0;
    _.each(weeks, week => {
        score += week.score;
        if (!week.stats) return;
        _.each(Object.keys(stats), stat => {
            stats[stat] += Number(week.stats[stat]) || 0;
        });
    });
    return {
        stats,
        score
    }
}

async function completeWeek() {
    const wk = await getCurrentWeek();
    if (wk.week === wk.realweek) {
        console.log('The week has already been completed');
        return;
    }
    console.log('week', wk);
    console.log('completing weeks');
    const stats = {};
    const defStats = {};
    const codes = await mongo.find('statCodes', {
                    fields: {
                        _id: 1,
                        def: 1
                    }
                });
    _.each(codes, code => {
        if (!!code.def)
            defStats[code._id] = 0;
        else
            stats[code._id] = 0;
    });
    _.each(await mongo.find('players'), player => {
        if (player.weeks.length >= wk.realweek) return;
        const query = { _id: player._id };
        const lastWeek = _.last(player.weeks);
        const set = {};
        set[`weeks.${player.weeks.length}`] = {
            cflteam: lastWeek.cflteam,
            nflteam: lastWeek.nflteam,
            num: wk.realweek,
            score: 0,
            stats: {}
        };
        if (!!lastWeek.IR) set[`weeks.${player.weeks.length}`].IR = true;
        const data = sumPlayerStats(player.weeks, player.position === 'DEF' ? {...defStats} : {...stats});
        set.score = data.score;
        set.stats = data.stats;
        mongo.update('players', {
            query,
            set
        });
    });
    console.log("PLAYERS UDPATED");
    getWinners();
}

schedule$
    .subscribe(res => {
        if (res === commands.COMPLETEWEEK) completeWeek();
    });

//setTimeout(completeWeek, 5000);