const express = require("express")
const session = require("express-session")
const bcrypt = require("bcrypt")
const logToWebhook = require("./utils/logger")

const app = express()
const db = require("./config/database")

app.set("view engine", "ejs")
app.set("trust proxy", 1)
app.use(express.static("public"))
app.use(express.urlencoded({ extended: true }))

// session
app.use(session({
    secret: "fib_secret",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax"
    }
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
app.use('/groups', require('./routes/groups'));
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

const port = Number(process.env.PORT || 3000)
app.listen(port, () => {
    console.log(`Site lancé sur le port ${port}`)
})