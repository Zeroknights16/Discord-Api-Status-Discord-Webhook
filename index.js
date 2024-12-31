const DiscordIncidentHandler = require('./src/incidentHandler.js');
const config = require('./config.json')
const handler = new DiscordIncidentHandler();

let i = 0;    
setInterval(async () => {
    try {
        console.log(`#${i++} » Updating Discord incidents`);
        await handler.checkFile();
        await handler.start();
        console.log(`--------  Update completed  --------------`);
        console.log('');
        console.log('');
    } catch (error) {
        console.error('(!) Error during interval execution:', error);
    }
}, config.intervalCheckingMinutes * 60000);
