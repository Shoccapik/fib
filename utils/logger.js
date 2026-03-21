const axios = require('axios');

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discordapp.com/api/webhooks/1484707119948103800/BW9ifn-QCnPQhBQW8Sy96kebFfz4RSfnjp80xDYO1AMoNCX96WKuKV5RDr54_WC24G7R';

async function logToWebhook(message, level = 'info', options = {}) {
    if(!WEBHOOK_URL || WEBHOOK_URL.includes('WEBHOOK_DISCORD')){
        console.warn('Webhook Discord non configuré ou invalide, log ignored :', message);
        return;
    }

    const emojis = {
        info: 'ℹ️',
        error: '❌',
        warn: '⚠️',
        debug: '🔍'
    };
    const emoji = emojis[level] || '📝';
    const timestamp = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

    const fields = [
        { name: 'Niveau', value: level, inline: true },
        { name: 'Heure', value: timestamp, inline: true }
    ];

    if (options.changes && options.changes.length > 0) {
        fields.push({
            name: 'Modifications',
            value: options.changes.join('\n').substring(0, 1024),
            inline: false
        });
    }

    try {
        await axios.post(WEBHOOK_URL, {
            embeds: [{
                title: `${emoji} ${level.toUpperCase()} | Nouvelle entrée`,
                description: message,
                color: level === 'error' ? 15158332 : level === 'warn' ? 16776960 : level === 'debug' ? 3447003 : 3066993,
                fields,
                footer: { text: 'FIB Portal Logger' },
                timestamp: new Date().toISOString()
            }]
        });
    } catch (error) {
        console.error('Échec de l\'envoi du log au webhook:', error);
    }
}

module.exports = logToWebhook;