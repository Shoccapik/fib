const express = require("express")
const router = express.Router()
const db = require("../config/database")
const auth = require("../middleware/auth")

router.get("/", auth, (req,res)=>{
    db.query("SELECT * FROM groups ORDER BY name", (err, groups)=>{
        if(err) return res.status(500).send("Erreur lors de la lecture des dossiers")
        res.render("groups", {groups: groups || [], user: req.session.user})
    })
})

router.post("/create", auth, (req,res)=>{
    const {name, claims, operating_places, hideout} = req.body
    if(!name || !name.trim()) return res.status(400).send("Le nom du dossier est requis")

    db.query(
        "INSERT INTO groups (name, claims, operating_places, hideout, created_by) VALUES (?, ?, ?, ?, ?)",
        [name.trim(), claims || null, operating_places || null, hideout || null, req.session.user.id],
        (err)=>{
            if(err) return res.status(500).send("Erreur lors de la création du dossier")
            res.redirect("/groups")
        }
    )
})

router.get("/:id", auth, (req,res)=>{
    db.query("SELECT * FROM groups WHERE id = ?", [req.params.id], (err, groups)=>{
        if(err) return res.status(500).send("Erreur lors de la lecture du dossier")
        if(!groups.length) return res.status(404).send("Dossier introuvable")

        const group = groups[0]
        db.query("SELECT r.*, u.username AS agent_username FROM reports r LEFT JOIN users u ON r.agent_id = u.id WHERE r.group_id = ? OR r.group_name = ? ORDER BY r.created_at DESC", [group.id, group.name], (reportErr, reports)=>{
            if(reportErr) return res.status(500).send("Erreur lors de la lecture des rapports")
            db.query("SELECT * FROM citizens WHERE group_id = ? OR affiliation = ? ORDER BY nom, prenom", [group.id, group.name], (citizenErr, citizens)=>{
                if(citizenErr) return res.status(500).send("Erreur lors de la lecture des citoyens")
                res.render("group_details", {group, groupName: group.name, reports: reports || [], citizens: citizens || [], user: req.session.user})
            })
        })
    })
})

module.exports = router
