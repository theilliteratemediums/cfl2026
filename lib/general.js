// jshint esversion:8

const mongo = require('./cflmongo');

// const startDate = '9/6/2022';
// const startDate = '9/5/2023';
// const startDate = '9/3/2024';
const startDate = '9/8/2026';
const _ = require('lodash');
let cflteams = [];
let standings = [];
let nflteams = [];

function getAdjustedDate(date = false) {
    const now = (!!date) ? new Date(date) : new Date();
    const az = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
    const diff = now.getTime() - az.getTime();

    return new Date(now.getTime() - diff);
}

async function cw() {
    const weeks = (await mongo.find('settings')).pop().weeks;
    const d = getAdjustedDate();
    const diffTime = (((d.getTime() - (new Date(startDate)).getTime())) / (1000 * 60 * 60 * 24));
    const realweek = (diffTime <= 0) ? 1 : Math.ceil(diffTime / 7);
    if (realweek > 18) return { week: 19, realweek: 19 };
    const currWeek = _.find(weeks, x => x.num === realweek);
    const week = (!!currWeek.started) ? realweek : realweek - 1;
    return { week, realweek };
}

module.exports = {
    async currentWeek() {
        return (await cw()).week;
    },
    async getCurrentWeek() {
        return await cw()
    },
}