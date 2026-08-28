const express = require("express")
const router = express.Router()
const db = require("../config/database")
const auth = require("../middleware/auth")
const logToWebhook = require("../utils/logger")
const multer = require("multer")
const path = require("path")
const fs = require("fs")

const uploadDirectory = path.join(__dirname, "..", "public", "uploads", "citizens")
const storage = multer.diskStorage({
    destination: (req, file, callback)=>{
        fs.mkdirSync(uploadDirectory, {recursive: true})
        callback(null, uploadDirectory)
    },
    filename: (req, file, callback)=>{
        const extension = path.extname(file.originalname).toLowerCase()
        callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`)
    }
})
const upload = multer({
    storage,
    limits: {fileSize: 5 * 1024 * 1024, files: 8},
    fileFilter: (req, file, callback)=>{
        const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"]
        callback(null, allowedTypes.includes(file.mimetype))
    }
})

const citizenFields = [
    { key: "nom", label: "Nom" },
    { key: "prenom", label: "Prénom" },
    { key: "dob", label: "Date de naissance" },
    { key: "phone", label: "Téléphone" },
    { key: "job", label: "Profession" },
    { key: "affiliation", label: "Affiliation" },
    { key: "permits", label: "Permis" },
    { key: "owned_vehicles", label: "Véhicules possédés" },
    { key: "residences", label: "Habitations" },
    { key: "registered_weapons", label: "Armes enregistrées" },
    { key: "wanted", label: "Recherché" },
    { key: "dangerous", label: "Dangereux" }
]

function citizenValues(body){
    return {
        nom: body.nom,
        prenom: body.prenom,
        dob: body.dob,
        phone: body.phone || null,
        job: body.job || null,
        affiliation: body.affiliation || null,
        permits: body.permits || null,
        owned_vehicles: body.owned_vehicles || null,
        residences: body.residences || null,
        registered_weapons: body.registered_weapons || null,
        wanted: body.wanted === "on" ? 1 : 0,
        dangerous: body.dangerous === "on" ? 1 : 0
    }
}

function displayValue(value, key){
    if(key === "wanted" || key === "dangerous") return Number(value) === 1 ? "Oui" : "Non"
    if(key === "dob"){
        if(!value) return "Non renseigné"
        if(typeof value === "string"){
            const isoDate = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
            if(isoDate){
                const [year, month, day] = isoDate.split("-")
                return `${day}/${month}/${year}`
            }
        }
        const date = new Date(value)
        if(!Number.isNaN(date.getTime())) return date.toLocaleDateString("fr-FR", {timeZone: "UTC"})
    }
    return String(value ?? "").trim() || "Non renseigné"
}

router.get("/",auth,(req,res)=>{

    db.query("SELECT * FROM citizens",(err,result)=>{
        if(err){
            console.error("Erreur SELECT citizens:", err)
            return res.send("Erreur lors de la lecture des citoyens")
        }
        db.query("SELECT id, name FROM groups ORDER BY name", (groupErr, groups)=>{
            if(groupErr) return res.status(500).send("Erreur lors de la lecture des groupes")
            res.render("citizens",{citizens:result || [], groups: groups || [], user: req.session.user})
        })
    })

})

router.get("/:id/edit", auth, (req,res)=>{
    db.query("SELECT * FROM citizens WHERE id = ?", [req.params.id], (err, rows)=>{
        if(err) return res.status(500).send("Erreur lors de la lecture du citoyen")
        if(rows.length === 0) return res.status(404).send("Citoyen introuvable")
        db.query("SELECT id, name FROM groups ORDER BY name", (groupErr, groups)=>{
            if(groupErr) return res.status(500).send("Erreur lors de la lecture des groupes")
            res.render("citizen_edit", {citizen: rows[0], groups: groups || [], user: req.session.user})
        })
    })
})

router.post("/create", auth, upload.array("photos", 8), (req,res)=>{

    const {
        nom, prenom, dob, phone, job, affiliation,
        permits, owned_vehicles, residences, registered_weapons, group_id
    } = req.body
    const wanted = req.body.wanted === "on" ? 1 : 0
    const dangerous = req.body.dangerous === "on" ? 1 : 0

    db.query(
        `INSERT INTO citizens
            (nom, prenom, dob, phone, job, affiliation, permits, owned_vehicles,
             residences, registered_weapons, photo_paths, group_id, wanted, dangerous)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            nom, prenom, dob, phone || null, job || null, affiliation || null,
                permits || null, owned_vehicles || null, residences || null,
                registered_weapons || null, JSON.stringify((req.files || []).map(file=>`/uploads/citizens/${file.filename}`)), group_id || null, wanted, dangerous
        ],
        (err)=>{
            if(err){
                console.error("Erreur INSERT citizen:", err)
                return res.status(500).send("Erreur lors de la création du citoyen")
            }
            res.redirect("/citizens")
        }
    )

})

router.post("/:id/update", auth, upload.array("photos", 8), (req,res)=>{
    const values = citizenValues(req.body)
    const groupId = req.body.group_id || null
    const user = req.session.user
    const authorization = user && user.id ? "ACCORDEE" : "REFUSEE"

    if(authorization === "REFUSEE"){
        return res.status(403).send("Modification non autorisée")
    }

    db.query("SELECT * FROM citizens WHERE id = ?", [req.params.id], (err, rows)=>{
        if(err) return res.status(500).send("Erreur lors de la lecture du citoyen")
        if(rows.length === 0) return res.status(404).send("Citoyen introuvable")

        const oldCitizen = rows[0]
        let existingPhotos = []
        try { existingPhotos = oldCitizen.photo_paths ? JSON.parse(oldCitizen.photo_paths) : [] } catch { existingPhotos = [] }
        const addedPhotos = (req.files || []).map(file=>`/uploads/citizens/${file.filename}`)
        const photoPaths = [...existingPhotos, ...addedPhotos]
        const changes = citizenFields
            .filter(field => displayValue(oldCitizen[field.key], field.key) !== displayValue(values[field.key], field.key))
            .map(field => `${field.label} : **${displayValue(oldCitizen[field.key], field.key)}** → **${displayValue(values[field.key], field.key)}**`)

        const sql = `UPDATE citizens SET
            nom = ?, prenom = ?, dob = ?, phone = ?, job = ?, affiliation = ?,
            permits = ?, owned_vehicles = ?, residences = ?, registered_weapons = ?,
            photo_paths = ?, group_id = ?, wanted = ?, dangerous = ? WHERE id = ?`
        db.query(sql, [
            values.nom, values.prenom, values.dob, values.phone, values.job,
            values.affiliation, values.permits, values.owned_vehicles,
            values.residences, values.registered_weapons, JSON.stringify(photoPaths), groupId,
            values.wanted, values.dangerous, req.params.id
        ], async (updateErr)=>{
            if(updateErr) return res.status(500).send("Erreur lors de la modification du citoyen")

            const changeList = changes.length ? changes : ["Aucune modification détectée"]
            const actor = user.username || `ID ${user.id}`
            const action = `Modification citoyen #${req.params.id} par ${actor} | Autorisation: ${authorization} | ${changeList.join(" | ")}`
            db.query(
                "INSERT INTO logs (action, actor_username, authorization, target_type) VALUES (?, ?, ?, ?)",
                [action, actor, authorization, "CITOYEN"],
                (logErr)=>{ if(logErr) console.error("Erreur log citoyen:", logErr) }
            )
            await logToWebhook(`Modification du dossier citoyen #${req.params.id} par ${actor}`, "info", {
                changes: [`Autorisation : ${authorization}`, ...changeList]
            })
            res.redirect(`/citizens/${req.params.id}`)
        })
    })
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