/**
 * XEAF Notification Service
 *
 * @author    Nick V. Anokhin <n.anokhin@xeaf.net>
 * @copyright XEAF.NET Group
 */

const __XEAF_NOTIFY_VERSION__ = '0.0.1';

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
X.canSend  = true;

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

/**
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

/**
 * Home page
 */
X.app.get('/', function (req, res) {
    let info = {
        title  : 'XEAF Notification Service',
        version: __XEAF_NOTIFY_VERSION__
    };
    res.send(info);
});

/**
 * Notify
 */
X.app.post('/notify', function (req, res) {
    let sender = req.query.sender;
    if (sender !== undefined) {
        if (X.config.senders.indexOf(sender) >= 0) {
            let message = {
                user : req.body.user,
                type : req.body.type,
                data : req.body.data,
                count: 0
            };
            X.queue.push(message);
            res.send({});

        } else {
            res.send({result: 'Bad sender authorization key.'});
        }
    } else {
        res.send({result: 'Could not find sender authorization key.'});
    }
});

/**
 * Sender
 */
X.interval = setInterval(function () {
    if (X.canSend && X.queue.length > 0) {
        X.canSend = false;
        for (let message of X.queue) {
            message.count = message.count + 1;
            if (message.count <= 5) {
                let notification = {
                    type: message.type,
                    data: message.data
                };
                X.sessions.forEach(function (socket) {
                    if (socket.userId === message.user) {
                        socket.emit('_NOTIFICATION', notification, function (data) {
                            if (data === 'OK') {
                                message.count = 7;
                            }
                        })
                    }
                });
            }
        }
        let idx = X.queue.length;
        while (idx--) {
            if (X.queue[idx].count >= 5) {
                X.queue.splice(idx, 1);
            }
        }
        X.canSend = true;
    }
}, 1000);
