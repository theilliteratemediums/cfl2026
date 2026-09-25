const mongo = require('./../cflmongo');
const { getCurrentWeek, currentWeek } = require('./../general.js');
const { commands, schedule$ } = require('./../rxjs');
const socket = require('./../socket');
const axios = require('axios');
const fs = require('fs-extra');
const _ = require('lodash');

const BOXSCORE_URL = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?region=us&lang=en&contentorigin=espn&features=ng&event=";
const statNames = ["passing", "rushing", "receiving", "kickReturns", "puntReturns", "kicking"];
let week;
let cflteams;
let allPlayers;
const positions = {
  QB: 2,
  RB: 3,
  WR: 3,
  K: 1,
  DEF: 1
};
let liveScoringActive = false;
let playerSocketData = [];
let nflSocketData = [];

function GetPlayerStats(teamInfo, teamID) {
  let plrs = [];
  let team = teamInfo.team.abbreviation;
  let stats = _.filter(teamInfo.statistics, x => _.includes(statNames, x.name));
  _(stats).each(stat => {
    let statName = stat.name;
    _(stat.athletes).each(plr => {
      let _id = parseInt(plr.athlete.id);
      let player = _.find(plrs, { _id });
      if (!player) {
        player = { _id, player: plr.athlete, team, teamID, stats: {}, score: 0 };
        plrs.push(player);
      };
      let s = player.stats;
      switch(statName) {
        case "passing":
          s["5"] = parseInt(plr.stats[1]);
          s["6"] = parseInt(plr.stats[3]);
          s["7"] = parseInt(plr.stats[4]);
          break;
        case "rushing":
          s["14"] = parseInt(plr.stats[1]);
          let rushTD = parseInt(plr.stats[3]);
          if (rushTD > 0) {
            s["15"] = rushTD;
            if (parseInt(plr.stats[4]) >= 40) {
              if (!player.bonusCheck) player.bonusCheck = [];
              player.bonusCheck.push(statName);
            }
          }
          break;
        case "receiving":
          s["21"] = parseInt(plr.stats[1]);
          let recTD = parseInt(plr.stats[3]);
          if (recTD > 0) {
            s["22"] = recTD;
            if (parseInt(plr.stats[4]) >= 50) {
              if (!player.bonusCheck) player.bonusCheck = [];
              player.bonusCheck.push(statName);
            }
          }
          break;
        case "kickReturns":
        case "puntReturns":
          let retTD = parseInt(plr.stats[4]);
          if (retTD > 0) s["28"] = retTD;
          break;
        case "kicking":
          let PATs = parseInt(_.first(_.split(plr.stats[3], "/")));
          if (PATs > 0) s["33"] = PATs;

          let FGs = parseInt(_.first(_.split(plr.stats[0], "/")));
          if (FGs > 0) {
            s["34"] = FGs;
            if (parseInt(plr.stats[2]) >= 40) {
              if (!player.bonusCheck) player.bonusCheck = [];
              player.bonusCheck.push(statName);
            }
          }
          break;
        default:
          console.log("WTF?");
          break;
      }
    })
  });
  return plrs;
}

async function init() {
  if (!!liveScoringActive) return;
  liveScoringActive = true;
  cflteams = await mongo.find("teams");
  week = await currentWeek();
  liveScoring();
}

async function liveScoring() {
  if (!liveScoringActive) return;
  nflSocketData = [];
  playerSocketData = [];
  let players = [];
  let games = await mongo.find('nflschedule', { query: {week} });
  for (var i = 0; i < games.length; i++) {
        let game = games[i];
        if (game.status === "game_closed") continue;
        let gameID = _.nth(_.split(game._id, "/"), -2);
        const stats = (await axios.get(`${BOXSCORE_URL}${gameID}`)).data;
        if (!stats.entities.plays) continue;

        console.log(`Getting the ${_.last(_.split(game._id, "/"))} stats`);
        let finalPlay = stats.entities.plays[_.last(Object.keys(stats.entities.plays))];

        let playType = finalPlay.type.slug;
        let status, clock, quarter;
        if (playType === "end-of-game") {
          quarter = null,
          clock = "Final",
          status = "game_closed"
        } else {
          quarter = finalPlay.period.number,
          clock = finalPlay.clock.displayValue,
          status = "game_active"
        }

        let set = {
          "home.score": finalPlay.homeScore,
          "away.score": finalPlay.awayScore,
          status,
          quarter,
          clock
        }
        await mongo.update('nflschedule', { query: { _id: game._id }, set });
        nflSocketData.push({
          id: game._id,
          data: {
            status,
            quarter,
            clock,
            homeScore: finalPlay.homeScore,
            awayScore: finalPlay.awayScore
          }
        })
        players.push({
          _id: (parseInt(game.away.id) + 100000).toString(),
          defense: true,
          home: false,
          espnId: stats.boxscore.teams[0].team.id,
          stats: {
            "46": (_.find(stats.boxscore.teams[1].statistics, { name: "interceptions"})).value,
            "50": (_.find(stats.boxscore.teams[0].statistics, { name: "defensiveTouchdowns"})).value,
            "54": finalPlay.homeScore
          },
          score: 0
        });
        players.push({
          _id: (parseInt(game.home.id) + 100000).toString(),
          defense: true,
          home: true,
          espnId: stats.boxscore.teams[1].team.id,
          stats: {
            "46": (_.find(stats.boxscore.teams[0].statistics, { name: "interceptions"})).value,
            "50": (_.find(stats.boxscore.teams[1].statistics, { name: "defensiveTouchdowns"})).value,
            "54": finalPlay.awayScore
          },
          score: 0
        });
        players = _.concat(players, GetPlayerStats(stats.boxscore.players[0]), parseInt(game.away.id));
        players = _.concat(players, GetPlayerStats(stats.boxscore.players[1]), parseInt(game.home.id));

        const drives = _(stats.entities.plays)
                          .filter(x => !!x.scoringPlay)//.value();
                          .map(play => {
                            let playType = play.type.slug;
                            switch (playType) {
                              case "safety":
                                let defPlayer = _.find(players, { espnId: play.team["$key"]});
                                if (!defPlayer.stats["49"]) defPlayer.stats["49"] = 0;
                                defPlayer.stats["49"]++;
                                break;
                              case "field-goal-good":
                                let yards = play.statYardage;
                                let statKey = 0;
                                if (yards >= 40) statKey = 38;
                                if (yards >= 50) statKey = 39;
                                if (statKey > 0) {
                                  let kicker = _.find(players, {_id: parseInt((_.find(play.participants, {type: "field_goal_kicker"})).athlete["$key"])});
                                  if (!kicker.stats[statKey]) kicker.stats[statKey] = 0;
                                  kicker.stats[statKey]++;
                                }
                                break;
                              case "passing-touchdown":
                                if (play.statYardage >= 50) {
                                  let receiver = _.find(players, {_id: parseInt((_.find(play.participants, {type: "receiver"})).athlete["$key"])});
                                  if (!receiver.stats["24"]) receiver.stats["24"] = 0;
                                  receiver.stats["24"]++;
                                }
                                break;
                              case "rushing-touchdown":
                                if (play.statYardage >= 40) {
                                  let rusher = _.find(players, {_id: parseInt((_.find(play.participants, {type: "rusher"})).athlete["$key"])});
                                  if (!rusher.stats["16"]) rusher.stats["16"] = 0;
                                  rusher.stats["16"]++;
                                }
                                break;
                              
                            }
                            return play;
                          })
                          .value();
  }
  GetScores(players);
}

function GetDefensiveStats(stats) {
  let score = 0;
  score += (stats["50"] || 0) * 6;
  score += (stats["49"] || 0) * 6;
  score += (stats["46"] || 0) * 3;

  let points = stats["54"];
  if (points === 0) score += 15;
  if (points > 0 && points <= 10) score += 5;
  if (points > 10 && points <= 20) score += 3;
  if (points > 30) score -= 5;
  return score;
}

function GetRegularStats(plr) {
  let stats = plr.stats;
  let score = 0;
  score += (stats["6"] || 0) * 6;
  score += (stats["7"] || 0) * -2;
  score += (stats["15"] || 0) * 8;
  score += (stats["16"] || 0) * 6;
  score += (stats["22"] || 0) * 8;
  score += (stats["24"] || 0) * 6;
  score += (stats["34"] || 0) * 3;
  score += (stats["33"] || 0);
  score += (stats["38"] || 0);
  score += (stats["39"] || 0) * 2;

  let passingYards = stats["5"];
  if (passingYards > 99) {
    score += 5;
    if (passingYards >= 150) score += 2;
    if (passingYards >= 200) score += 3;
    if (passingYards >= 250) score += 3;
    if (passingYards >= 300) score += 3;
    if (passingYards >= 350) score += 4;
    if (passingYards >= 400) score += (6 + Math.floor((passingYards - 400)/ 10));
  }

  let rushingYards = stats["14"];
  if (rushingYards >= 25) {
    score += 5;
    if (rushingYards >= 50) score += 2;
    if (rushingYards >= 75) score += 2;
    if (rushingYards >= 100) score += 3;
    if (rushingYards >= 130) score += 3;
    if (rushingYards >= 160) score += 4;
    if (rushingYards >= 200) score += (8 + Math.floor((rushingYards - 200)/ 10));
  }

  let recYards = stats["21"];
  if (recYards >= 25) {
    score += 5;
    if (recYards >= 50) score += 3;
    if (recYards >= 100) score += 4;
    if (recYards >= 130) score += 3;
    if (recYards >= 160) score += 3;
    if (recYards >= 200) score += 3;
    if (recYards >= 230) score += 4;
    if (recYards >= 250) score += (Math.floor((recYards - 250)/ 10));
  }
  return score;
}

function GetScores(players) {
  players = _(players)
              .filter(x => !!x.stats)
              .map(plr => {
                    if (plr.defense) 
                      plr.score = GetDefensiveStats(plr.stats);
                    else
                      plr.score = GetRegularStats(plr);
                    return plr;
                  })
              .value();
  // console.log(players);
 UpdatePlayersInDatabase(players); 
}

async function CFLSocketData() {
  const query = { week };
  await mongo.find('cflschedule', { query })
    .then(res => {
      const socketData = _.map(res, x => {
        return {
          id: x._id,
          data: {
            team1: x.team1,
            team2: x.team2,
          }
        }
      });
      socket.emit('cflschedule', socketData);
      console.log('emit', socketData);
      console.log('emit schedule', nflSocketData);
      console.log('emit players', playerSocketData);
      if (!!nflSocketData.length) socket.emit('nflschedule', nflSocketData);
      if (!!playerSocketData.length) socket.emit('player-stats', playerSocketData);
      setTimeout(liveScoring, 5000);
    })
}

async function teamScore(index = 0) {
  if (index >= cflteams.length) {
    setTimeout(liveScoring, 30 * 1000);
    return;
  }
  
  const team = cflteams[index];
  const id = team._id;
  const roster = _.chain(allPlayers)
                  .filter(x => x.weeks[week - 1].cflteam === id && !x.weeks[week-1].IR)
                  .sortBy(x => x.weeks[week - 1].score)
                  .sortBy('position')
                  .reverse()
                  .value();

    let ret = {};
    let score = 0;
    let tiebreaker = 0;
    _.each(Object.keys(positions), pos => ret[pos] = []);
    _.each(roster, plr => {
      const _week = plr.weeks[week-1];
      const pos = plr.position;
      if (!!_week.IR) return;
      if (ret[pos].length >= positions[pos]) return;
      if (!ret[pos].length) tiebreaker += _week.score;
      score += _week.score;
      ret[pos].push(plr);
    });
    
    console.log(team.team_name, score, tiebreaker);
    mongo.update("cflschedule", {
      query: {
        week,
        'team1.id': parseInt(id)
      },
      set: {
        'team1.score': score,
        'team1.tiebreaker': tiebreaker
      }
    });
    mongo.update("cflschedule", {
      query: {
        week,
        'team2.id': parseInt(id)
      },
      set: {
        'team2.score': score,
        'team2.tiebreaker': tiebreaker
      }
    });
    teamScore(++index);
}

async function UpdatePlayersInDatabase(players) {
  _(players).each(async player => {
    let _id = player._id;
    let query = { _id };
    let plr = _.first(await mongo.find('players', { query }));
    if (!!plr) {
      let stats = {};
      let score = 0;
      _(plr.weeks).each(wk => {
        if (wk.num === week) return true;
        score += wk.score;
        let statKeys = Object.keys(wk.stats);
        _(statKeys).each(key => {
          if (!stats[key]) stats[key] = 0;
          stats[key] += wk.stats[key];
        });
      })
      let set = {
        score,
        stats
      }
      set[`weeks.${week - 1}.stats`] = player.stats;
      set[`weeks.${week - 1}.score`] = player.score;
      await mongo.update('players', { query, set });
      playerSocketData.push({
        id: _id,
        week,
        data: {
          score,
          stats
        }
      });
    }
    return true;
  });
  allPlayers = await mongo.find("players");
  teamScore();
}

schedule$
  .subscribe(data => {
    if (data === commands.LIVESCORING) init();
    if (data === commands.STOPSCORING) liveScoringActive = false;
  })

module.exports = {
  init,
  liveScoringActive,
};

// setTimeout(init, 5000);