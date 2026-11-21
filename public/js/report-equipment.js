document.querySelectorAll("[data-equipment-list]").forEach(list => {
    const rows = list.querySelector("[data-equipment-rows]")
    const emptyMessage = list.querySelector("[data-equipment-empty]")
    const primaryValues = list.querySelector("[data-primary-values]")
    const secondaryValues = list.querySelector("[data-secondary-values]")

    function splitLines(value){
        const lines = String(value || "").split(/\r?\n/)
        while(lines.length && !lines[lines.length - 1].trim()) lines.pop()
        return lines
    }

    function syncValues(){
        const entries = Array.from(rows.children)
            .map(row => ({
                primary: row.querySelector("[data-entry-primary]").value.trim(),
                secondary: row.querySelector("[data-entry-secondary]").value.trim()
            }))
            .filter(entry => entry.primary || entry.secondary)

        primaryValues.value = entries.map(entry => entry.primary).join("\n")
        secondaryValues.value = entries.map(entry => entry.secondary).join("\n")
        emptyMessage.hidden = rows.children.length > 0
    }

    function addEntry(primary = "", secondary = ""){
        const row = document.createElement("div")
        row.className = "report-equipment-row"

        const primaryField = document.createElement("label")
        primaryField.className = "report-equipment-field"
        const primaryLabel = document.createElement("span")
        primaryLabel.textContent = list.dataset.primaryLabel
        const primaryInput = document.createElement("input")
        primaryInput.type = "text"
        primaryInput.placeholder = list.dataset.primaryPlaceholder
        primaryInput.value = primary
        primaryInput.setAttribute("data-entry-primary", "")
        primaryField.append(primaryLabel, primaryInput)

        const secondaryField = document.createElement("label")
        secondaryField.className = "report-equipment-field"
        const secondaryLabel = document.createElement("span")
        secondaryLabel.textContent = list.dataset.secondaryLabel
        const secondaryInput = document.createElement("input")
        secondaryInput.type = "text"
        secondaryInput.placeholder = list.dataset.secondaryPlaceholder
        secondaryInput.value = secondary
        secondaryInput.setAttribute("data-entry-secondary", "")
        secondaryField.append(secondaryLabel, secondaryInput)

        const removeButton = document.createElement("button")
        removeButton.className = "report-equipment-remove"
        removeButton.type = "button"
        removeButton.textContent = "Retirer"
        removeButton.setAttribute("aria-label", `Retirer ${list.dataset.primaryLabel.toLowerCase()}`)
        removeButton.addEventListener("click", () => {
            row.remove()
            syncValues()
        })

        row.append(primaryField, secondaryField, removeButton)
        rows.append(row)
        row.addEventListener("input", syncValues)
        syncValues()
    }

    const primaryLines = splitLines(primaryValues.value)
    const secondaryLines = splitLines(secondaryValues.value)
    const entryCount = Math.max(primaryLines.length, secondaryLines.length)

    if(entryCount){
        for(let index = 0; index < entryCount; index++){
            addEntry(primaryLines[index] || "", secondaryLines[index] || "")
        }
    } else {
        addEntry()
    }

    list.querySelector("[data-add-equipment]").addEventListener("click", () => addEntry())
    list.closest("form").addEventListener("submit", syncValues)
})
