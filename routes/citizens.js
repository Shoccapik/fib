const express = require("express")
const router = express.Router()
const db = require("../config/database")
const auth = require("../middleware/auth")

router.get("/",auth,(req,res)=>{

    db.query("SELECT * FROM citizens",(err,result)=>{
        if(err){
            console.error("Erreur SELECT citizens:", err)
            return res.send("Erreur lors de la lecture des citoyens")
        }
        res.render("citizens",{citizens:result || [], user: req.session.user})
    })

})

router.post("/create",auth,(req,res)=>{

    const {nom,prenom,dob} = req.body

    db.query(
        "INSERT INTO citizens (nom,prenom,dob) VALUES (?,?,?)",
        [nom,prenom,dob]
    )

    res.redirect("/citizens")

})

router.get("/:id", auth, (req,res)=>{
    const citizenId = req.params.id

    db.query("SELECT * FROM citizens WHERE id = ?", [citizenId], (err,citizens)=>{
        if(err){
            console.error("Erreur SELECT citizen:", err)
            return res.send("Erreur lors de la lecture du citoyen")
        }

        if(citizens.length === 0){
            return res.send("Citoyen introuvable")
        }

        const citizen = citizens[0]
        const name = `${citizen.prenom} ${citizen.nom}`.trim()

        db.query(
            "SELECT r.*, u.username AS agent_username FROM reports r LEFT JOIN users u ON r.agent_id = u.id WHERE r.personnes_concernees LIKE ? OR r.agents_concernes LIKE ? ORDER BY r.created_at DESC",
            [`%${name}%`,`%${name}%`],
            (err2, reports)=>{
                if(err2){
                    console.error("Erreur SELECT reports lié au citoyen:", err2)
                    return res.send("Erreur lors de la lecture des rapports")
                }

                res.render("citizen_details", {citizen, reports, user: req.session.user})
            }
        )
    })
})

module.exports = router