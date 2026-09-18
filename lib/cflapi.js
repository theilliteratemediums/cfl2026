// jshint esversion:8
const { resetPassword } = require('./email');
const axios = require("axios");
const mongo = require("./cflmongo");
const {
    getCurrentWeek,
    currentWeek
} = require("./general");
const _ = require('lodash');
const { emit } = require("./socket");

const limits = {
    QB: 2,
    RB: 5,
    WR: 5,
    K: 2,
    DEF: 2,
};

var wnba = {};

function isOlderThanOneHour(timestamp) {
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000); // 60 minutes * 60 seconds * 1000 milliseconds
  return timestamp < oneHourAgo;
}

function getStreak(games, team) {
  const strk = _.map(games, x => {
    return x.winner === team ? "W" : "L";
  });
  const type = _.first(strk);
  if (!type) return "-";
  let broken = false;
  let num = 0;
  _.each(strk, x => {
    if (broken) return;
    if (x === type)
      num++;
    else
      broken = true;
  });

  return `${type}${num.toString()}`;
}

module.exports = {
  async UpdateBlitz(data) {
    const query = { year: 2026 };
    const set = {};
    set[`weeks.${data.week-1}.blitz`] = data.html;
    await mongo.update('settings', { query, set });
  },
  async GetBlitz(week = 0) {
    if (!week) week = await currentWeek();
    return mongo.find('settings')
            .then(async res => {
              const blitz = res[0].weeks[week - 1].blitz;
              return blitz;
            })
  },
  async currentRound() {
    const week = await getCurrentWeek();
    const data = await mongo.find('settings');
    let settings = (_.first(data)).weeks.filter(x => x.num === week.week);
    return settings[0].moves.length + 1;
  },
  async moves() {
    return mongo.find('settings')
            .then(async res => {
              const moves = _.map(res[0].weeks, x => x.moves);
              const activations = _.map(res[0].weeks, x => x.activations);
              const trades = _.map(res[0].weeks, x => x.trades);
              return {
                moves,
                activations,
                trades
              }
            })
  },
  async wnba(payload) {
    var status = (Object.keys(payload))[0];
    let headers = JSON.parse(status);
    let current = wnba[headers.key];
    if (headers.override || !current || isOlderThanOneHour(current.timestamp)) {
      let querystring = "";
      if (!!headers.query) {
        querystring = "?";
        let arr = _.map(Object.keys(headers.query), key => {
          return `${key}=${headers.query[key]}`;
        });
        querystring = `?${arr.join("&")}`;
      }
      // headers should have a 'page' string and a querystring array
      
      let url = `/${headers.page}${querystring}`;
      console.log(`URL: ${url}`);

      const response = await axios.get(`https://wnba-api.p.rapidapi.com${url}`, {
        headers: {
          "x-rapidapi-host":"wnba-api.p.rapidapi.com",
          "x-rapidapi-key" : "93d4b0683emshacb2ed3af510a06p1ab8dcjsnbb5039a72f70"
        }
      });

      // let data = await apiClient.get(url);
      let data = response.data;
      let timestamp = Date.now();
      wnba[headers.key] = { data, timestamp }
    }
    return wnba[headers.key].data;
  },
  async draft() {
    const query = { year: 2026 };
    return await mongo.find('settings', { query })
                  .then(res => {
                    return _.map(res[0].draft, (id, index) => {
                      const round = Math.floor(index / 12) + 1;
                      let team = (index % 12) + 1;
                      if (!(round % 2)) team = 13 - team;
                      return {
                        id,
                        round,
                        team
                      }
                    });
                  });
  },
  async players() {
    return await mongo.find('players');
  },
  async owners() {
    return mongo.find('owners')
              .then(res => {
                return _.map(res, x => {
                  delete x.password;
                  delete x.initialized;
                  delete x.reset;
                  return x;
                })
              })
  },
  async cflteams() {
    const schedule = await this.cflschedule();
    return await mongo.find('teams')
          .then(res => {
            return _.map(res, team => {
              const ts = _.filter(schedule, x => x.team1.id === team._id || x.team2.id === team._id);
              const wins = _.filter(ts, x => !!x.winner && x.winner === team._id);
              const losses = _.filter(ts, x => !!x.winner && x.winner !== team._id);
              team.wins = wins.length;
              team.losses = losses.length;
              team.pct = (team.wins + team.losses) ? team.wins / (team.wins + team.losses) : "";
              team.streak = getStreak(_.chain(ts).filter(x => !!x.winner).reverse().value(), team._id);
              team.points = 0;
              _.each(ts, game => {
                if (!game.winner) return;
                if (game.team1.id === team._id) team.points += game.team1.score;
                if (game.team2.id === team._id) team.points += game.team2.score;
              });
              return team;
            })
          });
  },
  async nflteams() {
    return await mongo.find('nflteams');
  },
  async cflschedule(team = 0) {
    let query = {};
    if (!!team) query = {
        $or: [
          { 'team1.id': team },
          { 'team2.id': team }
        ]
    }
    return await mongo.find('cflschedule', { query, sort: { week: 1 }});
  },
  async nflschedule() {
    return await mongo.find('nflschedule');
  },
  async statCodes() {
    const query = { show: true };
    const sort = { _id: 1 };
    return await mongo.find("statCodes", { query, sort });
  },
  async week() {
    return await getCurrentWeek();
  },
  async activations() {
    return {};
  },
  async addWaiver() {
    return {};
  },
  async PasswordReset(owner_id) {
    owner_id = owner_id.toLowerCase();
    const query = { owner_id };
    const owner = await mongo.find('owners', { query });
    if (!owner.length) {
        return null;
    }
    return await resetPassword(owner[0]);
  },
  async changePassword(owner_id, password, key) {
    const query = {
      owner_id,
      'reset.key': key
    };
    let owner = await mongo.find('owners', { query });
    const set = { password };
    const data = await mongo.update('owners', { query, set });
    delete owner.password;
    const unset = { "reset" : "" };
    await mongo.unset('owners', { query, unset });
    return owner;
  },

  async login(owner_id, password, key) {
    if (!!key) {
      return await this.changePassword(owner_id, password, key);
    }
    const query = {
      owner_id,
      password
    };
    let owner = await mongo.find('owners', { query });
    delete owner.password;
    return owner;
  },
  async UpdateOwner(owner_id, property, value) {
    const query = { owner_id };
    const set = {};
    set[property] = value;
    await mongo.update('owners', { query, set });
    
  },
  async UpdateTeam(_id, property, value) {
    const query = { _id };
    const set = {};
    set[property] = value;
    await mongo.update('teams', { query, set });
    emit("team_updated", { _id, property, value });
  },
  async settings() {
    return (await mongo.find('settings')).pop();
  },
  async Message(data) {
    if (data._id) {
      // We will update the message here
    } else {
      data._id = Date.now();
      await mongo.insertOne('messages', data);
      return data;
    }
  },
  async WeeklyMessage() {
    const week = await getCurrentWeek();
    const data = await mongo.find('settings');
    let settings = (_.first(data)).weeks.filter(x => x.num === week.week);
    return (_.first(settings));
  }
};
