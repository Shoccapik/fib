const express = require("express")
const router = express.Router()
const auth = require("../middleware/auth")
const db = require("../config/database")

router.get("/", auth, (req,res)=>{
    const folder = req.query.folder === "sent" ? "sent" : "inbox"
    const username = req.session.user.username

    const inboxQuery = `
         SELECT m.id, m.subject AS title, m.content, m.sender, m.receiver, m.created_at,
             m.sender AS sender_name, m.receiver AS receiver_name
        FROM messages m
        WHERE m.receiver = ?
        ORDER BY m.id DESC`
    const sentQuery = `
         SELECT m.id, m.subject AS title, m.content, m.sender, m.receiver, m.created_at,
             m.sender AS sender_name, m.receiver AS receiver_name
        FROM messages m
        WHERE m.sender = ?
        ORDER BY m.id DESC`

        db.query(folder === "sent" ? sentQuery : inboxQuery, [username], (err, messages)=>{
        if(err){
            console.error("Erreur SELECT messages:", err)
            return res.status(500).send("Erreur lors de la lecture des messages")
        }

        db.query("SELECT username FROM users WHERE username <> ? ORDER BY username", [username], (userErr, users)=>{
            if(userErr){
                console.error("Erreur SELECT destinataires:", userErr)
                return res.status(500).send("Erreur lors de la lecture des destinataires")
            }

            res.render("messages", {
                messages,
                users,
                folder,
                user: req.session.user
            })
        })
    })
})

router.post("/send", auth, (req,res)=>{
    const { receiver, title, content } = req.body

    if(!receiver || !title || !content){
        return res.status(400).send("Destinataire, objet et message requis")
    }

    db.query(
        "INSERT INTO messages (sender, receiver, title, content) VALUES (?, ?, ?, ?)",
        [req.session.user.username, receiver, title.trim(), content.trim()],
        (err)=>{
            if(err){
                console.error("Erreur INSERT message:", err)
                return res.status(500).send("Erreur lors de l'envoi du message")
            }
            res.redirect("/messages?folder=sent")
        }
    )
})

router.post("/:id/delete", auth, (req,res)=>{
    const folder = req.body.folder === "sent" ? "sent" : "inbox"
    const ownerField = folder === "sent" ? "sender" : "receiver"

    db.query(
        `DELETE FROM messages WHERE id = ? AND ${ownerField} = ?`,
        [req.params.id, req.session.user.username],
        (err)=>{
            if(err){
                console.error("Erreur DELETE message:", err)
                return res.status(500).send("Erreur lors de la suppression du message")
            }
            res.redirect(`/messages?folder=${folder}`)
        }
    )
})

module.exports = router