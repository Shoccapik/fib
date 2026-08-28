const express = require("express")
const session = require("express-session")
const bcrypt = require("bcrypt")
const logToWebhook = require("./utils/logger")

const app = express()
const db = require("./config/database")

app.set("view engine", "ejs")
app.use(express.static("public"))
app.use(express.urlencoded({ extended: true }))

console.log(bcrypt.hashSync("admin123", 10))
console.log("Hash for 'admin':", bcrypt.hashSync("admin", 10))


// session
app.use(session({
    secret: "fib_secret",
    resave: false,
    saveUninitialized: false
}))

// FAKE USER (temporaire)
const user = {
    username: "admin",
    password: bcrypt.hashSync("admin123", 10)
}

// middleware protection
function isAuth(req, res, next){
    if(!req.session.user){
        return res.redirect("/")
    }
    next()
}

// routes

app.use('/auth', require('./routes/auth'));
app.use('/users', require('./routes/users'));
app.use('/citizens', require('./routes/citizens'));
app.use('/messages', require('./routes/messages'));
app.use('/reports', require('./routes/reports'));
app.use('/service', require('./routes/service'));
app.use('/logs', require('./routes/logs'));

app.get("/", (req, res) => {
    res.render("login")
})

app.get("/logout", (req,res)=>{
    req.session.destroy((err)=>{
        if(err) return res.send("Erreur")
        res.redirect("/")
    })
})

// Les routes /reports sont gérées par routes/reports.js via app.use('/reports', require('./routes/reports'))
// (évite les conflits et permet /reports/:id)

// Optionnel : laisser un fallback /logout unique
app.get("/logout",(req,res)=>{
    logToWebhook(`Déconnexion de l'utilisateur: ${req.session.user ? req.session.user.username : 'inconnu'}`, 'info')
    req.session.destroy()
    res.redirect("/")
})

app.listen(3000, () => {
    console.log("Site lancé sur http://localhost:3000")
})