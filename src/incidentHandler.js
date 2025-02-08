const https = require('https');
const fs = require('fs');
const { EmbedBuilder, WebhookClient } = require('discord.js');
const { join } = require('path');
const config = require('../config.json');
const _ = require('lodash');

module.exports = class DiscordIncidentHandler {
    constructor() {
        this.apiUrl = 'https://discordstatus.com/api/v2/incidents.json';
        this.cacheFileName = join(__dirname, 'messages.json');
        this.ignoreDays = config.ignoreDays || 30;
        this.ignoreTime = this.ignoreDays * 86400000;
        this.webhookClient = new WebhookClient({ url: config.webhook_url });

        console.log(`Ignoring incidents from ${this.ignoreDays} days ago (${this.ignoreTime} ms).`);
    }

    async checkIncident(incident) {
        const id = incident.id;
        const incidentUpdate = Date.parse(incident.updated_at);

        if (Date.now() - incidentUpdate > this.ignoreTime) {
            console.debug(`(?) Skipping update of incident ${id} because it's too old.`);
            return;
        }

        const messageId = await this.getMessageIdOfIncident(id);
        if (!messageId) {
            await this.createMessage(incident);
            return;
        }

        let message;
        try {
            message = await this.webhookClient.fetchMessage(messageId);
        } catch (error) {
            console.error(`(!) Error fetching message for incident ${id}:`, error);
            await this.createMessage(incident);
            return;
        }

        if (!message || !message.embeds.length) {
            await this.createMessage(incident);
            return;
        }

        if (message.embeds.length == 0) {
            await this.updateMessage(message, incident);
            return;
        }

        const messageUpdate = Date.parse(message.embeds[0].timestamp);
        if (messageUpdate !== incidentUpdate) {
            await this.updateMessage(message, incident);
        }
    }

    buildIncidentEmbed(incident) {
        const embed = new EmbedBuilder()
            .setTitle(incident.name)
            .setURL(incident.shortlink)
            .setColor(this.getStatusColor(incident.status))
            .setFooter({ text: `Incident ID: ${incident.id}` })
            .setTimestamp(new Date(incident.updated_at));

        const components = incident.components.map(component => component.name).join(', ');
        embed.setDescription(`• Impact: ${incident.impact}\n• Affected Components: ${components}`);

        incident.incident_updates.reverse().forEach(update => {
            embed.addFields({
                name: `${_.startCase(update.status)} (${new Date(update.created_at).toLocaleString()})`,
                value: update.body
            });
        });

        return embed;
    }

    async createMessage(incident) {
        const id = incident.id;
        const json = await this.readMessagesFile();
        const messageId = await this.sendIncident(incident);

        json[id] = messageId;
        console.log(`(:) Created new message for incident ${id} with message-id ${messageId}.`);
        fs.writeFileSync(this.cacheFileName, JSON.stringify(json, null, 4));
    }

    async updateMessage(message, incident) {
        console.log(`(:) Updating message for incident ${incident.id}.`);
        await message.edit({ embeds: [this.buildIncidentEmbed(incident)] });
    }

    async start() {
        try {
            const data = await this.fetchIncidents();
            const incidents = data.incidents.reverse();

            for (const incident of incidents) {
                try {
                    await this.checkIncident(incident);
                } catch (error) {
                    console.error('(!) Error checking incident:', error);
                }
            }
        } catch (error) {
            console.error('(!) Error fetching incidents:', error);
        }
    }

    async sendIncident(incident) {
        const response = await this.webhookClient.send({ embeds: [this.buildIncidentEmbed(incident)] });
        return response.id;
    }

    async checkFile() {
        if (!fs.existsSync(this.cacheFileName)) {
            fs.writeFileSync(this.cacheFileName, JSON.stringify({}));
        }
    }

    async readMessagesFile() {
        const data = fs.readFileSync(this.cacheFileName, 'utf-8');
        return JSON.parse(data);
    }

    async getMessageIdOfIncident(id) {
        const messages = await this.readMessagesFile();
        return messages[id];
    }

    async fetchIncidents() {
        return new Promise((resolve, reject) => {
            https.get(this.apiUrl, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`(!) Failed to parse incidents: ${error.message}`));
                    }
                });
            }).on('error', (error) => {
                reject(new Error(`(!) Failed to fetch incidents: ${error.message}`));
            });
        });
    }

    getStatusColor(status) {
        switch (status) {
            case 'resolved':
                return '#06A51B';
            case 'monitoring':
                return '#A3A506';
            case 'identified':
                return '#A55806';
            default:
                return '#A50626';
        }
    }
}