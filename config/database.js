const mysql = require("mysql2")

const db = mysql.createPool({
    host: "localhost",
    port: 3306,
    user: "admin12",
    password: "casti3l&shoccs",
    database: "fib_portal",
    connectTimeout: 10000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
})

const requiredColumns = [
    ["citizens", "group_id", "INT NULL"],
    ["citizens", "vehicle_details", "TEXT NULL"],
    ["citizens", "weapon_details", "TEXT NULL"],
    ["reports", "report_type", "VARCHAR(30) NOT NULL DEFAULT 'Compte-rendu'"],
    ["reports", "claims", "TEXT NULL"],
    ["reports", "operating_places", "TEXT NULL"],
    ["reports", "hideout", "VARCHAR(255) NULL"],
    ["reports", "group_id", "INT NULL"],
    ["reports", "personnes_concernees", "TEXT"],
    ["reports", "agents_concernes", "TEXT"],
    ["reports", "vehicules", "TEXT"],
    ["reports", "plaques", "TEXT"],
    ["reports", "armes", "TEXT"],
    ["reports", "numeros_serie", "TEXT"]
]

function ensureColumn(table, column, definition, done){
    db.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column], (err, columns)=>{
        if(err) return done(err)
        if(columns.length) return done()
        db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`, done)
    })
}

function ensureSessionTable(done){
    db.query(
        `CREATE TABLE IF NOT EXISTS app_sessions (
            sid VARCHAR(128) NOT NULL PRIMARY KEY,
            expires BIGINT UNSIGNED NOT NULL,
            data MEDIUMTEXT NOT NULL,
            INDEX app_sessions_expires_idx (expires)
        )`,
        done
    )
}

db.ready = new Promise((resolve, reject)=>{
    let index = 0
    const next = (migrationErr) => {
        if(migrationErr) return reject(migrationErr)
        if(index === requiredColumns.length){
            return db.query("UPDATE reports SET level = 1 WHERE level IS NULL OR level < 1 OR level > 4", updateErr=>{
                if(updateErr) return reject(updateErr)
                resolve()
            })
        }
        const [table, column, definition] = requiredColumns[index++]
        ensureColumn(table, column, definition, next)
    }
    ensureSessionTable(next)
})

db.ready
    .then(() => console.log("MySQL connecté et schéma vérifié"))
    .catch(err => console.error("Erreur DB / schéma :", err))

module.exports = db