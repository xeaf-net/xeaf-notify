/**
 * XEAF Notification Service
 *
 * @author    Nick V. Anokhin <n.anokhin@xeaf.net>
 * @copyright XEAF.NET Group
 */

const __XEAF_NOTIFY_VERSION__ = '1.0.2';

/*
 * Load modules
 */
const fs     = require('fs');
const app    = require('express')();
const config = require('config.json');
const server = require('http').createServer({
    key               : fs.readFileSync('/etc/ssl/certs/dummy.key'),
    cert              : fs.readFileSync('/etc/ssl/certs/dummy.crt'),
    ca                : fs.readFileSync('/etc/ssl/certs/dummy_ca.crt'),
    requestCert       : false,
    rejectUnauthorized: false
}, app);
const io     = require('socket.io')(server);
const redis  = require('redis');
const body   = require('body-parser');

/*
 * Entry point
 */
const X      = {};
X.app        = app;
X.config     = config();
X.redis      = redis.createClient(X.config.redis.port, X.config.redis.host);
X.io         = io;
X.queue      = [];
X.sessions   = [];
X.interval   = null;
X.redisRenew = null;

X.app.use(body.json());
X.app.use(body.urlencoded({extended: true}));

server.listen(X.config.port);
console.log('XEAF Notification Service started at port ', X.config.port);

/*
 * Redis
 */
X.redis.on('error', function (err) {
    console.error('Redis: Something went wrong ' + err);
});

/*
 * Socket IO
 */
X.io.on('connection', function (socket) {
    socket.on('disconnect', function () {
        let idx = X.sessions.indexOf(socket);
        if (idx >= 0) {
            X.sessions.splice(idx, 1);
        }
    });
});

/*
 * Socket IO authorization
 */
io.use(((socket, next) => {
    let q = socket.handshake.query;
    if (q.session !== undefined) {
        let name = 'xns-' + q.session;
        X.redis.get(name, function (error, result) {
            if (error) {
                throw error;
            }
            if (result !== undefined && result !== null) {
                socket.sessionId = q.session;
                socket.userId    = result;
                X.sessions.push(socket);
                X.redisRenew(q.session, result);
                next();
            } else {
                next(new Error('Bad session id.'));
            }
        });
    } else {
        next(new Error('Authentication error.'));
    }
}));

/*
 * Home page
 */
X.app.get('/', function (req, res) {
    let info = {
        title  : 'XEAF Notification Service',
        version: __XEAF_NOTIFY_VERSION__
    };
    res.send(info);
});

/*
 * Login
 */
X.app.post('/login', function (req, res) {
    let sender = req.query.sender;
    if (sender !== undefined) {
        if (X.config.senders.indexOf(sender) >= 0) {
            X.redisRenew(req.query.session, req.query.user);
            res.send({response: 'OK'});
        } else {
            res.send({response: 'Bad sender authorization key.'});
        }
    } else {
        res.send({response: 'Could not find sender authorization key.'});
    }
});

/*
 * Logout
 */
X.app.post('/logout', function (req, res) {
    let sender = req.query.sender;
    if (sender !== undefined) {
        if (X.config.senders.indexOf(sender) >= 0) {
            let name = 'xns-' + req.query.session;
            X.redis.del(name);
            res.send({response: 'OK'});
        } else {
            res.send({response: 'Bad sender authorization key.'});
        }
    } else {
        res.send({response: 'Could not find sender authorization key.'});
    }
});

/*
 * Notify
 */
X.app.post('/notify', function (req, res) {
    let sender = req.query.sender;
    if (sender !== undefined) {
        if (X.config.senders.indexOf(sender) >= 0) {
            // noinspection JSUnresolvedVariable
            for (let user of req.body.users) {
                let message = {
                    user     : user,
                    type     : req.body.type,
                    data     : req.body.data,
                    timestamp: +new Date()
                };
                X.queue.push(message);
            }
            res.send({response: 'OK'});
        } else {
            res.send({response: 'Bad sender authorization key.'});
        }
    } else {
        res.send({response: 'Could not find sender authorization key.'});
    }
});

/*
 * Sender
 */
X.interval = setInterval(function () {
    if (X.queue.length > 0) {
        let list = [...X.queue];
        X.queue  = [];
        for (let message of list) {
            let time = (+new Date()) - message.timestamp;
            if (time < 1000 * X.config.deliver) {
                let notification = {
                    type     : message.type,
                    data     : message.data,
                    timestamp: message.timestamp
                };
                X.sessions.forEach(function (socket) {
                    if (socket.userId === message.user && (message.socketId === undefined || message.socketId === socket.id)) {
                        socket.emit('_NOTIFICATION', notification, function (data) {
                            if (data !== 'OK') {
                                if (message.socketId === undefined) {
                                    let copy      = Object.assign({}, message);
                                    copy.socketId = socket.id;
                                    X.queue.push(copy);
                                } else {
                                    X.queue.push(message);
                                }
                            } else {
                                X.redisRenew(socket.sessionId, socket.userId);
                            }
                        })
                    }
                });
            }
        }
    }
}, 1000);

/**
 * Renew Redis TTL for sessionId
 */
X.redisRenew = function (sessionId, userId) {
    let name = 'xns-' + sessionId;
    X.redis.set(name, userId, 'EX', X.config.redis.expired);
};
