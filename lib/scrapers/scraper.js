const mongo = require('./../cflmongo');
const { getCurrentWeek, currentWeek } = require('./../general.js');
const cheerio = require('cheerio');
const { commands, schedule$ } = require('./../rxjs');
const fs = require('fs-extra');
const _ = require('lodash');

async function getHtmlString(url) {
  try {
    const response = await fetch(url);
    
    // Check if the request was successful
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    // Convert the response body to a string
    const htmlString = await response.text();
    return htmlString;
  } catch (error) {
    console.error('Error fetching the HTML:', error);
  }
}

let NFLTeams = [];
const positions = ["QB", "RB", "WR", "TE", "PK", "FB"];
const score = 0;
const lgId = "3200434f-4f01-2674-9f08-fe944758464a";
let allPlayers = [];
let week;

async function getNFL() {
    const nflPath = "./rosters/cfl2025.nflteams.json";
    let data = await fs.readFileSync(nflPath);
    return _(JSON.parse(data))
                .map(elem => {
                    elem.nflTeamId = parseInt(elem.nflTeamId);
                    return elem;
                })
                .orderBy('nflTeamId')
                .value();
}

async function getAllPlayers() {
    return await mongo.find('players');
}

async function updatePlayers() {
    week = await getCurrentWeek();
    NFLTeams = await mongo.find("nflteams");
    await resetPlayers();
}

async function resetPlayers() {
    let plrs = await getAllPlayers();
    await _.each(plrs, async plr => {
                        if (plr.position === "DEF") return true;
                        let query = { _id: plr._id };
                        let set = {};
                        set[`weeks.${week.week - 1}.nflteam`] = 0;
                        await mongo.update('players', { query, set });
                        plr.weeks[week.week - 1].nflteam = 0;
                        allPlayers.push(plr);
                        return true;
                    });
    console.log('reset players is done');
    // await fs.writeFileSync("./lib/scrapers/data/allPlayers.json", JSON.stringify(allPlayers, null, 2), 'utf8');
    // return false;
    return await ProcessNFLTeam();
}

async function ProcessNFLTeam(indexNFL = 0) {
    if (indexNFL >= NFLTeams.length) {
        console.log("ALL DONE!");
        return true;
    }
    const team = NFLTeams[indexNFL];
    const tricode = (team.abbr).toLowerCase();
    const nflteam = parseInt(team.nflTeamId);
    const url = `https://www.espn.com/nfl/team/roster/_/name/${tricode}/`;
    console.log(`Fetching the ${team.nickName}...`);
    getHtmlString(url).then(async html => {
        const $ = cheerio.load(html);
        const rosters = $('.Offense, .Special, .Injured');
        let players = await $(rosters).find('.Table__TR--lg')
                .filter((index, element) => {
                    let cols = $(element).find(('.Table__TD'));
                    let pos = cols.eq(2).text().trim();
                    return _.includes(positions, pos);
                })
                .map(async (index, element) => {
                    let cols = $(element).find(('.Table__TD'));
                    let playerInfo = cols.eq(1);
                    let playerLink = $(playerInfo).find('.AnchorLink');
                    let plrLink = _.split($(playerLink).attr('href'), "/");
                    const _id = parseInt(_.nth(plrLink, -2));
                    if (!_id) return null;

                    let playerDB = _.find(allPlayers, { _id });
                    if (!playerDB) {
                        let position = cols.eq(2).text().trim();
                        if (position === "TE") position = "WR";
                        if (position === "FB") position = "RB";
                        if (position === "PK") position = "K";
                        
                        const fullname = playerLink.text().trim();
                        let arr = _.split(fullname, " ");
                        const firstname = arr.shift();
                        const lastname = arr.join(" ");
                        const number = parseInt($(playerInfo).find(".roster-jersey").text().trim());

                        const pic = $(cols.eq(0)).find('img').attr('alt');
                        const weeks = [];

                        for (var num = 1; num < week.week; num++) {
                            weeks.push({
                                num,
                                cflteam: 0,
                                nflteam: 0,
                                score,
                                stats: {}
                            });
                        }
                        weeks.push({
                            num: week.week,
                            cflteam: 0,
                            nflteam,
                            score,
                            stats: {}
                        })

                        playerDB = {
                            _id,
                            score,
                            firstname,
                            lastname,
                            fullname,
                            number,
                            position,
                            pic,
                            lgId,
                            weeks,
                            stats: {}
                        }
                        await mongo.insertOne('players', playerDB);
                        console.log(`${fullname} from ${team.nickName} has been added to the DB (${_id})`);
                        allPlayers.push(playerDB);
                    } else {
                        let query = { _id };
                        let set = {};
                        set[`weeks.${week.week -1}.nflteam`] = nflteam;
                        console.log(`${playerDB.fullname} from ${team.nickName} was already in the DB (${_id})`);
                        await mongo.update('players', { query, set });
                        playerDB.weeks[week.week - 1].nflteam = nflteam;
                    }
                    return playerDB;
                })
                .filter(x => !!x);
        console.log(`Total Players On The ${team.nickName}: ${players.length}`);
        console.log("");
        return await ProcessNFLTeam(++indexNFL);
    });
}

async function addWeekToPlayers() {
    const wk = await getCurrentWeek();
    console.log(wk);
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
        // const data = sumPlayerStats(player.weeks, player.position === 'DEF' ? {...defStats} : {...stats});
        // set.score = data.score;
        // set.stats = data.stats;
        mongo.update('players', {
            query,
            set
        });
    });
    console.log("PLAYERS UDPATED");
}

schedule$
    .subscribe(data => {
        if (data === commands.UPDATEPLAYERS) updatePlayers();
    })


