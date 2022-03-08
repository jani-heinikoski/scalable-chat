// Author: Jani Heinikoski, Created: 08.03.2022
// Sources: Node.js v17.6.0 documentation
const net = require("net");
const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
});
const question = require("util").promisify(readline.question).bind(readline);
// Operation codes for communicating with the server
const REQUEST_NICKNAME = 1;
const PRIVATE_MESSAGE = 2;
// Arrays for storing the messages
const privateMessages = [];
const channelMessages = [];
// Variable for holding the nickname gotten from the server
let nickname;
// Gets user input from stdin
const getInput = async (text) => {
    const answer = await question(`${text}> `);
    return answer;
};
// CLI for using the client software after successfully establishing
// connection with the server.
const cli = async (socket) => {
    let temp;
    const MENU = `
Choose an option ${nickname}:
1) View private messages
2) Send a private message
3) Join channel
4) View channels
0) EXIT\n`;
    while (true) {
        console.log(MENU);
        temp = await getInput(`Choose`);
        if (temp && temp.length === 1) {
            switch (temp) {
                case "0":
                    socket.destroy();
                    process.exit(0);
                case "1":
                    privateMessages.forEach((e) =>
                        console.log(`${e.from} > ${e.msg}`)
                    );
                    await getInput("Hit enter to continue");
                    break;
                case "2":
                    temp = await getInput(`Enter recipient's nickname`);
                    socket.write(
                        JSON.stringify({
                            msg: await getInput("Enter the message"),
                            to: temp,
                            cmd: PRIVATE_MESSAGE,
                        })
                    );
                    break;
            }
        }
    }
};
// Fired when receiving data from the server
const onSocketReceiveData = (data, socket) => {
    try {
        obj = JSON.parse(data.toString("utf8"));
        switch (obj.cmd) {
            // This is always the first case to happen when connecting to a server.
            // Proceed with the CLI only after getting a free nickname from the server.
            case REQUEST_NICKNAME:
                if (!obj.success) {
                    console.log(
                        "Nickname is already reserved, restart and try again..."
                    );
                    process.exit(0);
                }
                nickname = obj.nickname;
                console.log("Connection established successfully\n");
                cli(socket);
                break;
            case PRIVATE_MESSAGE:
                privateMessages.push(obj);
                break;
        }
    } catch (ex) {
        console.log("Got malformed data from the server, exiting...");
        socket.destroy();
        process.exit(-1);
    }
};
// Fired when the client socket throws an error
const onSocketError = async (err, socket) => {
    socket.destroy();
    if (err.code === "ECONNRESET") {
        console.log("Lost connection to the server, exiting...\n");
    } else if (err.code === "ECONNREFUSED") {
        console.log("Can't connect to the server, exiting...\n");
    } else {
        console.log("Unexpected error was thrown, exiting...\n");
        throw err;
    }
    process.exit(-1);
};
// Startup and initialization
const main = async () => {
    // Set the user's nickname for the server
    const nickName = await getInput("Choose your nickname");
    console.log(`\nHello ${nickName}\n`);
    // Get the IP-address of the server
    const serverIP = await getInput("Enter the server's IP-address");
    console.log(`Connecting to ${serverIP}`);
    // Connect to the server
    const clientSocket = net.createConnection(
        { host: "127.0.0.1", port: 3000 },
        () => {
            clientSocket.write(
                JSON.stringify({ msg: nickName, cmd: REQUEST_NICKNAME })
            );
        }
    );
    // Attach event listeners for the client socket
    clientSocket.on("data", (data) => onSocketReceiveData(data, clientSocket));
    clientSocket.on("error", (err) => onSocketError(err, clientSocket));
};

main();
