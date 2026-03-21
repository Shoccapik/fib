const mysql = require("mysql2")

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "fib_portal"
})

db.connect((err) => {
    if (err) {
        console.error("Erreur DB :", err)
    } else {
        console.log("MySQL connecté ✅")
    }
})

module.exports = db