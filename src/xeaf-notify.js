/**
 * XEAF Notification Service
 *
 * @author    Nick V. Anokhin <n.anokhin@xeaf.net>
 * @copyright XEAF.NET Group
 */

const __XEAF_NOTIFY_VERSION__ = '1.0.1';

/*
 * Load modules
 */
const app    = require('express')();
const config = require('config.json');
const server = require('http').createServer(app);
const io     = require('socket.io')(server);
const redis  = require('redis');
const body   = require('body-parser');

/*
 * Entry point
 */
const X    = {};
X.app      = app;
X.config   = config();
X.redis    = redis.createClient(X.config.redis.port, X.config.redis.host);
X.io       = io;
X.queue    = [];
X.sessions = [];
X.interval = null;

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
                socket.userId = result;
                X.sessions.push(socket);
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
            let user = req.query.user;
            let name = 'xns-' + req.query.session;
            X.redis.set(name, user);
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
                    user : user,
                    type : req.body.type,
                    data : req.body.data,
                    count: 0
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
            message.count = message.count + 1;
            if (message.count <= 5) {
                let notification = {
                    type: message.type,
                    data: message.data
                };
                X.sessions.forEach(function (socket) {
                    if (socket.userId === message.user) {
                        socket.emit('_NOTIFICATION', notification, function (data) {
                            if (data !== 'OK') {
                                X.queue.push(message);
                            }
                        })
                    }
                });
            }
        }
    }
}, 1000);
