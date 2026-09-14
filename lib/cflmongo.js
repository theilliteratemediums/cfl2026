// jshint esversion:6

const assert = require('assert');
const fs = require('fs-extra');
let players = {};

const dbName = 'cfl2026';
const MongoClient = require('mongodb').MongoClient;
let client = null;

function connectToMongo() {
    return new Promise((resolve, reject) => {
        const data = JSON.parse(fs.readFileSync('lib/data.json'));
        const client = new MongoClient(data.mongo.uri, {
            useNewUrlParser: true
        });
        client.connect(err => {
            assert.equal(err, null);
            if (!!err) reject(err);
            resolve(client);
        });
    })
}

connectToMongo()
    .then(res => {
        client = res;
        console.log("Successful DB Connection!");
        console.log(__dirname);
    })
    .catch(err => {
        console.log('could not connect to mongo');
    })


const find = (collection, data = {}) => {
    let query = data.query || {};
    let sort = data.sort || {};
    let fields = data.fields || {};
    return new Promise((resolve, reject) => {
        let db = client.db(dbName);
        db.collection(collection).find(query, {
            fields
        }).sort(sort).toArray((err, items) => {
            if (err) {
                reject(err);
            } else {
                resolve(items);
            }
        });
    });
}

module.exports = {
    connected() {
        return !!client;
    },
    players,
    find,
    findOne(collection, data = {}) {
        let query = data.query || {};
        let fields = data.fields || {};
        return new Promise((resolve, reject) => {
            let db = client.db(dbName);
            db.collection(collection).find(query, {
                fields
            }).toArray((err, items) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(items);
                }
            });
        });
    },
    insertOne(collection, data) {
        let db = client.db(dbName);
        db.collection(collection).insertOne(data);
    },
    inesertMany(collection, data) {
        let db = client.db(dbName);
        db.collection(collection).insertMany(data);
    },
    update(collection, data) {
        if (!data.set) return;
        if (!data.query) return;
        let db = client.db(dbName);
        db.collection(collection).updateOne(data.query, {
                $set: data.set
            })
            .then(res => {})
            .catch(err => {})
    },
    addToArray(collection, data) {
        if (!data.addToSet) return;
        if (!data.query) return;
        let db = client.db(dbName);
        db.collection(collection).updateOne(data.query, {
                $addToSet: data.addToSet
            })
            .then(res => {})
            .catch(err => {})
    },
    pushToArray(collection, data) {
        if (!data.push) return;
        if (!data.query) return;
        let db = client.db(dbName);
        db.collection(collection).updateOne(data.query, {
                $push: data.push
            })
            .then(res => {})
            .catch(err => {})
    },
    updateMany(collection, data) {
        if (!data.set) return;
        if (!data.query) data.query = {};
        let db = client.db(dbName);
        db.collection(collection).updateMany(data.query, {
                $set: data.set
            })
            .then(res => {})
            .catch(err => {})
    },
    unset(collection, data) {
        if (!data.unset) return;
        if (!data.query) data.query = {};
        let db = client.db(dbName);
        db.collection(collection).updateOne(data.query, {
            $unset: data.unset
        }).then(res => {}).catch(err => {});
    },
    popFromArray(collection, data) {
        if (!data.pop) return;
        if (!data.query) data.query = {};
        let db = client.db(dbName);
        db.collection(collection).updateOne(data.query, {
            $pop: data.pop
        }).then(res => {}).catch(err => {});
    }
}