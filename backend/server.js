// Author: Jani Heinikoski, Created: 08.03.2022
// Sources: Node.js v17.6.0 documentation
const cluster = require("cluster");
const process = require("process");
const { cpus } = require("os");
const net = require("net");
// Number of cores in the system, used to spawn nOfCPUs amount of workers
const nOfCPUs = cpus().length;
// Operation codes for client - server & master - worker communication
const REQUEST_NICKNAME = 1;
const PRIVATE_MESSAGE = 2;
const REQUEST_JOIN_CHANNEL = 3;
const CHANNEL_MESSAGE = 4;
const RELEASE_NICKNAME = 11;
// Operation codes for master - worker communication
// Main process uses this to store already reserved nicknames of workers
const reservedNicknames = [];
// Contains all of the worker's REQUEST_NICKNAME - requests
// until the master process has resolved them.
const pendingNicknameRequests = [];
// Workers use this to maintain record which nickname belongs to which socket
// so that the nicknames can be released when a socket dies.
const socketNicknames = [];
// Workers use this to determine which clients are subscribed to a channel
// Key - name of the channel, value - array of connected sockets
const channelSubscriptions = new Map();
// Initialize the map with some hardcoded channels
for (let x = 1; x < 11; x++) {
    channelSubscriptions.set(`CH${x}`, []);
}
// Utility functions
const validateNicknameRequest = (obj) => {
    if (
        !obj ||
        obj.cmd !== REQUEST_NICKNAME ||
        !obj.msg ||
        obj.msg.length < 1
    ) {
        return false;
    }
    return true;
};
const validatePrivateMessage = (obj) => {
    if (
        !obj ||
        obj.cmd !== PRIVATE_MESSAGE ||
        !obj.msg ||
        obj.msg.length < 1 ||
        !obj.to ||
        obj.to.length < 1
    ) {
        return false;
    }
    return true;
};
const validateJoinChannelRequest = (obj, socket) => {
    if (
        !obj ||
        obj.cmd !== REQUEST_JOIN_CHANNEL ||
        !obj.msg ||
        obj.msg.length < 1 ||
        !channelSubscriptions.get(obj.msg)
    ) {
        return false;
    }
    // Check if the client is already subscribed
    for (const subscribedSocket of channelSubscriptions.get(obj.msg)) {
        if (socket === subscribedSocket) {
            return false;
        }
    }
    return true;
};
const validateChannelMessage = (obj) => {
    return !(
        !obj ||
        obj.cmd !== CHANNEL_MESSAGE ||
        !obj.msg ||
        obj.msg.length < 1 ||
        !obj.channel ||
        obj.channel.length < 1
    );
};
const appendSenderNicknameToObj = (obj, socket) => {
    const senderNickname = socketNicknames.find(
        (e) => e.socket === socket
    ).nickname;
    obj.from = senderNickname;
};
const checkNicknameAlreadyInUse = (nickname) => {
    for (const { name } of reservedNicknames) {
        if (name === nickname) {
            return true;
        }
    }
    return false;
};
// Sockets' event handlers
// Fired when the worker's socket is receiving data
const onSocketReceiveData = (data, socket) => {
    try {
        const obj = JSON.parse(data.toString());
        if (validateNicknameRequest(obj)) {
            pendingNicknameRequests.push({ socket: socket, nickname: obj.msg });
            process.send(obj);
        } else if (validateJoinChannelRequest(obj, socket)) {
            channelSubscriptions.get(obj.msg).push(socket);
            socket.write(JSON.stringify({ ...obj, success: true }));
        } else if (validatePrivateMessage(obj) || validateChannelMessage(obj)) {
            appendSenderNicknameToObj(obj, socket);
            process.send(obj);
        } else {
            socket.write(JSON.stringify({ ...obj, success: false }));
        }
    } catch (ex) {}
};
// Fired when the socket closes
const onSocketClosed = (erroneus) => {
    console.log("Socket closed. Had errors?", erroneus);
    // Socket has been closed -> find it if it exists in socketNicknames
    const socketNamePair = socketNicknames.find(
        (elem) => elem.socket.destroyed === true
    );
    if (socketNamePair) {
        // Release the nickname for other clients
        process.send({ msg: socketNamePair.nickname, cmd: RELEASE_NICKNAME });
        // Remove the pair from memory
        socketNicknames.splice(socketNicknames.indexOf(socketNamePair));
    }
    // Remove the socket from channel subscriptions
    let socket;
    for (const subs of channelSubscriptions.values()) {
        socket = subs.find((elem) => elem.destroyed === true);
        subs.splice(subs.indexOf(socket));
    }
};
// Fired when socket throws an error
const onSocketError = (err) => {
    console.log(`Socket error at worker ${process.pid} ${err.code}`);
};
// Master - worker event listeners
// Fired when the master process receives a message from a worker
const onMasterReceivedMsg = (obj, worker, broadcastToWorkers) => {
    if (obj) {
        switch (obj.cmd) {
            case REQUEST_NICKNAME:
                // Check if the nickname has already been reserved.
                if (checkNicknameAlreadyInUse(obj.msg)) {
                    worker.send({
                        msg: "Nickname is already in use.",
                        nickname: obj.msg,
                        cmd: REQUEST_NICKNAME,
                        success: false,
                    });
                    return;
                }
                // If not, reserve it and tell the worker that it is available
                reservedNicknames.push({ owner: worker.id, name: obj.msg });
                worker.send({
                    msg: "Nickname is available.",
                    nickname: obj.msg,
                    cmd: REQUEST_NICKNAME,
                    success: true,
                });
                break;
            case CHANNEL_MESSAGE:
            case PRIVATE_MESSAGE:
                broadcastToWorkers(obj);
                break;
            case RELEASE_NICKNAME:
                // Removes a reserved nickname
                const nicknameToRelease = reservedNicknames.find(
                    (e) => e.nickname === obj.msg
                );
                reservedNicknames.splice(
                    reservedNicknames.indexOf(nicknameToRelease)
                );
                break;
            default:
                break;
        }
    }
};
// Fired when a worker receives a message from the master process
const onWorkerReceivedMsg = (obj) => {
    if (!obj) {
        return;
    }
    switch (obj.cmd) {
        case REQUEST_NICKNAME:
            // Master has resolved a pending nickname request
            // --> find it and send the result to the client
            const pendingRequest = pendingNicknameRequests.find(
                (elem) => elem.nickname === obj.nickname
            );
            pendingRequest.socket.write(JSON.stringify(obj));
            // If the nickname was reserved successfully, save the socket - nn pair
            if (obj.success) {
                socketNicknames.push(pendingRequest);
            }
            // Remove the pending request from memory
            pendingNicknameRequests.splice(
                pendingNicknameRequests.indexOf(pendingRequest)
            );
            break;
        case PRIVATE_MESSAGE:
            for (const socketNamePair of socketNicknames) {
                if (socketNamePair.nickname === obj.to) {
                    socketNamePair.socket.write(
                        JSON.stringify({ ...obj, success: true })
                    );
                }
            }
            break;
        case CHANNEL_MESSAGE:
            for (const subscribedSocket of channelSubscriptions.get(
                obj.channel
            )) {
                subscribedSocket.write(
                    JSON.stringify({ ...obj, success: true })
                );
            }
            break;
    }
};
// Fired when a worker exits
const onWorkerExit = (code, signal, worker) => {
    console.log("Worker exited, signal:", signal);
    // Release the reserved nicknames of the worker that died
    for (const obj of reservedNicknames.filter((e) => e.owner === worker.id)) {
        reservedNicknames.splice(reservedNicknames.indexOf(obj));
    }
};
// Forking and initialization
if (cluster.isPrimary) {
    console.log(`Primary running PID ${process.pid}`);
    // Function for sending a message to all of the workers from the master
    const broadcastToWorkers = (obj) => {
        for (const worker of Object.values(cluster.workers)) {
            worker.send(obj);
        }
    };
    // Fork workers
    for (let i = 0; i < nOfCPUs; i++) {
        let worker = cluster.fork();
        worker.on("message", (obj) =>
            onMasterReceivedMsg(obj, worker, broadcastToWorkers)
        );
        worker.on("exit", (code, signal) => onWorkerExit(code, signal, worker));
    }
} else {
    console.log(`worker started PID ${process.pid}`);
    // Create the TCP server
    const server = net.createServer((socket) => {
        socket.on("data", (data) => onSocketReceiveData(data, socket));
        socket.on("error", onSocketError);
        socket.on("close", onSocketClosed);
    });
    // Specify error handler for the TCP server
    server.on("error", (err) => {
        console.error(err);
        process.exit(-1);
    });
    // Event listener for messages from the process
    process.on("message", onWorkerReceivedMsg);
    // Start listening on host:port
    server.listen({ host: "127.0.0.1", port: 3000 }, () => {
        console.log("Listening on ", server.address());
    });
}
