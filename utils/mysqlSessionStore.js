const session = require("express-session")

class MySQLSessionStore extends session.Store {
    constructor(db, ttl){
        super()
        this.db = db
        this.ttl = ttl

        this.cleanupTimer = setInterval(()=>{
            this.db.query("DELETE FROM app_sessions WHERE expires <= ?", [Date.now()], (err)=>{
                if(err) console.error("Erreur nettoyage des sessions expirées:", err)
            })
        }, 15 * 60 * 1000)
        this.cleanupTimer.unref()
    }

    get(sid, callback){
        this.db.query(
            "SELECT data FROM app_sessions WHERE sid = ? AND expires > ?",
            [sid, Date.now()],
            (err, rows)=>{
                if(err) return callback(err)
                if(!rows.length) return callback(null, null)

                try {
                    callback(null, JSON.parse(rows[0].data))
                } catch(parseErr) {
                    callback(parseErr)
                }
            }
        )
    }

    set(sid, sessionData, callback){
        const expires = this.getExpiration(sessionData)
        let data
        try {
            data = JSON.stringify(sessionData)
        } catch(err) {
            return callback(err)
        }

        this.db.query(
            `INSERT INTO app_sessions (sid, expires, data) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
            [sid, expires, data],
            callback
        )
    }

    touch(sid, sessionData, callback){
        this.db.query(
            "UPDATE app_sessions SET expires = ? WHERE sid = ?",
            [this.getExpiration(sessionData), sid],
            callback
        )
    }

    destroy(sid, callback){
        this.db.query("DELETE FROM app_sessions WHERE sid = ?", [sid], callback)
    }

    getExpiration(sessionData){
        const cookie = sessionData.cookie || {}
        const expires = cookie.expires ? new Date(cookie.expires).getTime() : Date.now() + this.ttl
        return Number.isFinite(expires) ? expires : Date.now() + this.ttl
    }
}

module.exports = MySQLSessionStore
