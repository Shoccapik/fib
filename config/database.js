const mysql = require("mysql2")

const db = mysql.createConnection({
    host: "localhost",
    port: 3306,
    user: "admin12",
    password: "casti3l&shoccs",
    database: "fib_portal"
})

const requiredColumns = [
    ["citizens", "group_id", "INT NULL"],
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

db.ready = new Promise((resolve, reject)=>{
    db.connect((err) => {
        if (err) return reject(err)

        let index = 0
        const next = (migrationErr) => {
            if(migrationErr) return reject(migrationErr)
            if(index === requiredColumns.length) return resolve()
            const [table, column, definition] = requiredColumns[index++]
            ensureColumn(table, column, definition, next)
        }
        next()
    })
})

db.ready
    .then(() => console.log("MySQL connecté et schéma vérifié"))
    .catch(err => console.error("Erreur DB / schéma :", err))

module.exports = db