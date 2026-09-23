const rx = require('rxjs');
const _ = require('lodash');
const { commands, schedule$ } = require('./rxjs');

const timer = rx.timer(0, 1000);

const schedule = [
    {
        dow: [0,1,2,3,4,5,6],
        hour: 6,
        minute: 0,
        command: commands.UPDATEPLAYERS,
        active:true,
    },
    {
        dow: [0,1,3,4,5,6],
        hour: 23,
        minute: 0,
        command: commands.STOPSCORING,
        active:true,
    },
    {
        dow: [2],
        hour: 12,
        minute: 0,
        command: commands.COMPLETEWEEK,
        active:true,
    },
    {
        dow:[4,6,0],
        hour: 0,
        minute: 1,
        command: commands.MOVES,
        active:true,
    },
    {
        dow:[4],
        hour: 17,
        minute: 15,
        command: commands.MOVESANDLIVESCORING,
        active:true,
    },
    {
        dow:[0],
        hour: 6,
        minute: 30,
        active:false,
        command: commands.LIVESCORING
    },
    {
        dow: [0],
        hour: 9,
        minute:15,
        active:false,
        command: commands.STOPSCORING
    },
    {
        dow:[6],
        hour:10,
        minute:0,
        command: commands.MOVESANDLIVESCORING,
        active: false,
    },
    {
        dow:[4],
        hour:9,
        minute:30,
        command: commands.MOVESANDLIVESCORING,
        active:false,
    },
    {
        dow:[0],
        hour:10,
        minute:0,
        command: commands.MOVESANDLIVESCORING,
        active:true,
    },
    {
        dow:[0],
        hour:6,
        minute:30,
        command: commands.LIVESCORING,
        active:false,
    },
    {
        dow:[0],
        hour:8,
        minute:0,
        command: commands.STOPSCORING,
        active:true,
    },
    {
        dow: [1],
        hour: 17,
        minute: 15,
        command: commands.LIVESCORING,
        active:true,
    },
]

function getAdjustedDate(date = false) {
    const now = (!!date) ? new Date(date) : new Date();
    const az = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));

    const diff = now.getTime() - az.getTime();

    return new Date(now.getTime() - diff);
}

timer
    .pipe(
        rx.map(x => {
            return (new Date).getMinutes();
        }),
        rx.distinctUntilChanged()
    )
    .subscribe(x => {
        const d = getAdjustedDate();
        const dow = d.getDay();
        const hour = d.getHours();
        const minute = d.getMinutes();
        console.log(`${hour}:${minute < 10 ? '0' : ''}${minute}`);
        const event = _.filter(schedule, x => {
            return (!!x.active && _.includes(x.dow, dow) && x.hour === hour && x.minute === minute);
        });
        // if (!!event.length && !!process.env.PORT) {
        if (!!event.length) {
            console.log('Event to fire: ', event[0].command);
            schedule$.next(event[0].command);
        }
    });

module.exports = {
    updateScoringTime(date = false) {
        let dow = -1;
        let hour = -1;
        let minute = -1;
        if (!!date) {
            const d = getAdjustedDate(date);
            dow = d.getDay();
            hour = d.getHours();
            minute = d.getMinutes();
        }
        if (!!dow) return;
        const ls = _.find(schedule, x => !!x.flex);
        ls.dow = [dow];
        ls.hour = hour;
        ls.minute = minute;
    
        console.log('scheduler updated', ls, schedule);
    }
}