import { db } from './firebase-config.js';
import {
    collection,
    onSnapshot,
    updateDoc,
    doc,
    addDoc,
    getDocs,
    setDoc,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// Global Data State
let bedsData = [];
let patientHistory = [];
let isSeeding = false;
let hasInitialized = false;

// Initialize on Load
initialize();

async function initialize() {
    console.log('NexusCare PA Farmácia initialized with Firebase');
    initializeNavigation();
    updateHeaderDate();

    // Setup Real-time Listeners
    setupBedsListener();
    setupHistoryListener();
}

// --- Firebase Listeners ---

function setupBedsListener() {
    const bedsCollection = collection(db, "beds");
    const container = document.getElementById('bed-grid-container');

    onSnapshot(bedsCollection, (snapshot) => {
        const tempBeds = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data && data.id) tempBeds.push(data);
        });

        console.log(`Beds Snapshot: ${tempBeds.length} items (Live: ${!snapshot.metadata.fromCache})`);

        // Connectivity Indicator
        const statusEl = document.getElementById('sync-status');
        if (statusEl) {
            if (snapshot.metadata.fromCache) {
                statusEl.className = 'sync-status offline';
                statusEl.querySelector('span').textContent = 'Sincronizando...';
            } else {
                statusEl.className = 'sync-status online';
                statusEl.querySelector('span').textContent = 'Sincronizado';
            }
        }

        // Always update bedsData with what we have
        bedsData = tempBeds.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));

        // Show status in the loading screen if it's still there
        const loadingMsg = document.getElementById('loading-msg');
        if (loadingMsg && tempBeds.length < 15) {
            loadingMsg.textContent = `Carregando leitos (${tempBeds.length}/15 encontrados)...`;
        }

        // Selective Seeding: Only create missing beds
        if (tempBeds.length < 15 && !isSeeding) {
            const missingIds = [];
            for (let i = 1; i <= 15; i++) {
                if (!tempBeds.some(b => Number(b.id) === i)) missingIds.push(i);
            }
            if (missingIds.length > 0) {
                console.log("Seeding missing beds:", missingIds);
                seedDatabase(missingIds);
            }
        }

        // Render as soon as we have at least one bed
        if (tempBeds.length > 0) {
            initializeBedGrid();
            renderPatientListIfActive();
            updateOccupancyStats();
        }
    }, (error) => {
        console.error("Beds Listener Error:", error);
        if (container) {
            container.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--danger);">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                    <p><strong>Erro de Conexão:</strong> Não foi possível ler o banco de dados.</p>
                    <p style="font-size: 0.8rem; margin: 1rem 0;">${error.message}</p>
                    <button class="btn btn-primary" onclick="location.reload()">Tentar Novamente</button>
                </div>`;
        }
    });
}

function setupHistoryListener() {
    const historyCollection = collection(db, "history");
    // Order by timestamp desc would be ideal in query, but timestamp format string?
    // We'll trust the natural order or sort client side for simple string dates
    // Ideally user proper timestamps. For this legacy compatibility we keep string
    // but a real app should use Firestore Timestamp.

    // Let's rely on client-side sort for mixed formats if needed or just display order

    const q = query(historyCollection, orderBy("timestamp", "desc"));

    // Note: If timestamp is string, "desc" might not work perfectly for all date formats. 
    // But we will stick to string for compatibility with existing code.

    onSnapshot(q, (snapshot) => {
        const tempHistory = [];
        snapshot.forEach(doc => {
            tempHistory.push(doc.data());
        });
        patientHistory = tempHistory;

        // Update Views depending on what is active
        const patientsView = document.getElementById('view-patients');
        if (patientsView && patientsView.style.display !== 'none') {
            renderHistory();
        }
        updateDailyStats(); // Stats depend on history
    });
}

// --- Database Seeding ---

async function seedDatabase(missingIds = []) {
    if (isSeeding || (missingIds.length === 0 && bedsData.length >= 15)) return;
    isSeeding = true;
    console.log(`Seeding missing beds: ${missingIds.join(', ')}`);
    try {
        const promises = [];
        // If no specific IDs provided, check all 1-15
        const idsToSeed = missingIds.length > 0 ? missingIds : Array.from({ length: 15 }, (_, i) => i + 1);

        for (const id of idsToSeed) {
            // Check if it already exists in our local state to be extra safe
            if (bedsData.some(b => b.id === id)) continue;

            const bedId = `bed_${String(id).padStart(2, '0')}`;
            const bedRef = doc(db, "beds", bedId);
            promises.push(setDoc(bedRef, { id: id, status: 'available' }, { merge: true }));
        }

        if (promises.length > 0) {
            await Promise.all(promises);
            console.log(`Seeding complete. ${promises.length} beds added.`);
        }
    } catch (err) {
        console.error("Seeding Error:", err);
    } finally {
        isSeeding = false;
    }
}

// Global expose for troubleshooting
window.forceResetBeds = seedDatabase;

// --- Navigation & Views ---

function initializeNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            // Remove active class from all
            navItems.forEach(nav => nav.classList.remove('active'));
            // Add to clicked (closest in case click is on icon/text)
            e.currentTarget.classList.add('active');

            // Handle Navigation
            const textHTML = item.querySelector('span').innerHTML;
            if (textHTML === 'Pacientes') {
                switchView('patients');
            } else if (textHTML === 'Dashboard') {
                switchView('dashboard');
            } else if (textHTML === 'Lista de Pacientes') {
                switchView('patient-list');
            } else {
                console.log("Navigation to " + textHTML);
            }
        });
    });
}

function switchView(viewName) {
    const dashboardView = document.getElementById('view-dashboard');
    const patientsView = document.getElementById('view-patients');
    const listView = document.getElementById('view-patient-list');

    // Hide all
    if (dashboardView) dashboardView.style.display = 'none';
    if (patientsView) patientsView.style.display = 'none';
    if (listView) listView.style.display = 'none';

    // Show selected
    if (viewName === 'patients') {
        if (patientsView) patientsView.style.display = 'block';
        renderHistory();
    } else if (viewName === 'patient-list') {
        if (listView) listView.style.display = 'block';
        renderPatientList();
    } else {
        if (dashboardView) dashboardView.style.display = 'block';
    }
}

function updateHeaderDate() {
    const dateElement = document.getElementById('header-date');
    if (dateElement) {
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' };
        // Format: "terça-feira, 03/02/2026"
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        const weekday = now.toLocaleDateString('pt-BR', { weekday: 'long' });

        // Capitalize weekday
        const weekdayCapitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);

        dateElement.textContent = `${day}/${month}/${year} - ${weekdayCapitalized}`;
    }
}

// --- Data Operations (Refactored for Firebase) ---

async function addToHistory(type, patientName, details, user = "FS") {
    // Current Timestamp
    // Generating sortable timestamp for query if we wanted to change schema, 
    // but keeping format compatible: "dd/mm/yyyy hh:mm:ss"
    const now = new Date();
    // Use ISO string for sorting field if we wanted to be robust, but sticking to existing logic
    // Actually, let's just save the string as user expects for display

    // We can add a 'createdAt' field for sorting which is a standard number/timestamp
    const entry = {
        timestamp: now.toLocaleString('pt-BR'),
        sortableTime: now.getTime(), // Helper for sorting
        patient: patientName,
        type: type,
        details: details,
        user: user
    };

    try {
        await addDoc(collection(db, "history"), entry);
    } catch (e) {
        console.error("Error adding history: ", e);
    }
}

function getDateFromTimestamp(ts) {
    if (!ts) return "";
    let datePart = ts.split(' ')[0] || "";
    datePart = datePart.replace(',', ''); // remove trailing comma
    return datePart;
}

function updateDailyStats() {
    const now = new Date();
    const todayStr = now.toLocaleDateString('pt-BR'); // "dd/mm/yyyy"

    // Helper to extract date part regardless of locale formatting (handles "/" or "-")
    const normalizeDate = (dateStr) => {
        if (!dateStr) return "";
        // Extract first 10 characters or before the first comma/space
        const part = dateStr.split(/[,\s]/)[0];
        return part;
    };

    const todayNormalized = normalizeDate(todayStr);

    const admissionsCount = patientHistory.filter(entry => {
        const entryDate = normalizeDate(entry.timestamp);
        return entryDate === todayNormalized && entry.type === 'Admissão';
    }).length;

    const transfersCount = patientHistory.filter(entry => {
        const entryDate = normalizeDate(entry.timestamp);
        return entryDate === todayNormalized && entry.type === 'Transferência';
    }).length;

    const dischargesCount = patientHistory.filter(entry => {
        const entryDate = normalizeDate(entry.timestamp);
        return entryDate === todayNormalized && entry.type === 'Alta';
    }).length;

    const elAdmissions = document.getElementById('daily-admissions-count');
    if (elAdmissions) elAdmissions.textContent = admissionsCount;

    const elTransfers = document.getElementById('daily-transfers-count');
    if (elTransfers) elTransfers.textContent = transfersCount;

    const elDischarges = document.getElementById('daily-discharges-count');
    if (elDischarges) elDischarges.textContent = dischargesCount;
}

function renderPatientListIfActive() {
    const listView = document.getElementById('view-patient-list');
    if (listView && listView.style.display !== 'none') renderPatientList();
}

// Global functions exposed to window for onclick handlers
window.openAdmissionModal = function (bedId) {
    const modal = document.getElementById('admission-modal');
    if (!modal) return;

    modal.dataset.targetBedId = bedId || '';
    const unitSelect = document.getElementById('patient-unit');
    unitSelect.innerHTML = '<option value="">Selecione...</option>' + createOptions(null);
    document.getElementById('admission-form').reset();
    modal.classList.add('active');
}

window.closeModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        if (modalId === 'admission-modal') delete modal.dataset.targetBedId;
    }
}

window.openTransferModal = function (patientId) {
    const modal = document.getElementById('transfer-modal');
    if (!modal) return;
    document.getElementById('transfer-patient-id').value = patientId;
    const unitSelect = document.getElementById('transfer-unit');
    unitSelect.innerHTML = '<option value="">Selecione...</option>' + createOptions(null);
    modal.classList.add('active');
}

window.handleAdmission = async function () {
    const modal = document.getElementById('admission-modal');
    const targetBedId = modal.dataset.targetBedId ? parseInt(modal.dataset.targetBedId) : null;

    const name = document.getElementById('patient-name').value;
    const birthDate = document.getElementById('patient-birth').value;
    const unit = document.getElementById('patient-unit').value;

    if (!name || !birthDate || !unit) {
        alert("Por favor, preencha todos os campos.");
        return;
    }

    let bedIndex = -1;
    // Note: bedsData is now the array from Firestore
    if (targetBedId) {
        bedIndex = bedsData.findIndex(b => b.id === targetBedId);
    } else {
        bedIndex = bedsData.findIndex(b => b.status === 'available');
    }

    if (bedIndex === -1) {
        alert("Não há leitos disponíveis!");
        return;
    }

    const bedIdDoc = `bed_${String(bedsData[bedIndex].id).padStart(2, '0')}`;
    const bedDocRef = doc(db, "beds", bedIdDoc);
    console.log(`Attempting admission for ${name} in ${bedIdDoc}...`);

    try {
        await updateDoc(bedDocRef, {
            status: 'occupied',
            patient: name,
            origin: unit,
            destination: "---",
            birthDate: birthDate,
            admissionTime: new Date().toLocaleString('pt-BR'),
            transferTime: "---",
            dischargeTime: "---"
        });
        console.log("Admission saved successfully!");

        // Log History
        await addToHistory('Admissão', name, `Admitido em ${unit} (Leito ${bedsData[bedIndex].id})`);

        closeModal('admission-modal');
    } catch (error) {
        console.error("Error processing admission:", error);
        alert("Erro ao realizar admissão. Verifique o console.");
    }
}

window.handleTransfer = async function () {
    const patientId = parseInt(document.getElementById('transfer-patient-id').value);
    const newUnit = document.getElementById('transfer-unit').value;

    if (!newUnit) {
        alert("Por favor, selecione a unidade de destino.");
        return;
    }

    const bedIndex = bedsData.findIndex(b => b.id === patientId);
    if (bedIndex > -1) {
        let currentLoc = bedsData[bedIndex].destination !== "---" ? bedsData[bedIndex].destination : bedsData[bedIndex].origin;
        const bedIdDoc = `bed_${String(bedsData[bedIndex].id).padStart(2, '0')}`;

        try {
            // Log History first
            await addToHistory('Transferência', bedsData[bedIndex].patient, `Transferido de ${currentLoc} para ${newUnit}`);

            // Clear Bed
            await updateDoc(doc(db, "beds", bedIdDoc), {
                status: 'available',
                // Remove patient data
                patient: null,
                origin: null,
                destination: null,
                birthDate: null,
                admissionTime: null,
                transferTime: null,
                dischargeTime: null
                // Note: Firestore doesn't delete fields unless we use FieldValue.delete(), 
                // but setting to null or overwriting is fine for our current display logic which checks status
            });

            closeModal('transfer-modal');
        } catch (error) {
            console.error("Error processing transfer:", error);
            alert("Erro ao realizar transferência.");
        }
    }
}

window.handleDischarge = async function (bedId) {
    if (!confirm("Confirmar a alta do paciente? Isso liberará o leito.")) return;

    const bedIndex = bedsData.findIndex(b => b.id === bedId);
    if (bedIndex > -1) {
        const bedIdDoc = `bed_${String(bedsData[bedIndex].id).padStart(2, '0')}`;

        try {
            // Log History
            await addToHistory('Alta', bedsData[bedIndex].patient, `Alta de ${bedsData[bedIndex].destination !== "---" ? bedsData[bedIndex].destination : bedsData[bedIndex].origin}`);

            // Clear Bed
            await updateDoc(doc(db, "beds", bedIdDoc), {
                status: 'available',
                // Remove patient data
                patient: null,
                origin: null,
                destination: null,
                birthDate: null,
                admissionTime: null,
                transferTime: null,
                dischargeTime: null
            });
        } catch (error) {
            console.error("Error processing discharge:", error);
            alert("Erro ao realizar alta.");
        }
    }
}


// --- Rendering ---
// (Mostly same as before, just ensuring variable scope is correct)

const hospitalUnits = [
    "APARTAMENTOS",
    "MARIA VIEIRA",
    "BELAMIRA AZEREDO",
    "CÂNDIDA",
    "MEIMEI",
    "GERALDOCARNEIRO"
];

function calculateAge(birthDateString) {
    if (!birthDateString) return 0;
    const today = new Date();
    const birthDate = new Date(birthDateString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

function createOptions(selectedUnit) {
    return hospitalUnits.map(unit =>
        `<option value="${unit}" ${unit === selectedUnit ? 'selected' : ''}>${unit}</option>`
    ).join('');
}

function initializeBedGrid() {
    const gridContainer = document.getElementById('bed-grid-container');
    if (!gridContainer) return;
    renderBedGrid(gridContainer);
}

function renderBedGrid(container) {
    if (!container) return;
    container.innerHTML = '';
    console.log("Current bedsData in render:", bedsData);

    bedsData.forEach(bed => {
        try {
            const card = document.createElement('div');
            card.className = 'card bed-card';

            if (bed.status === 'available') {
                card.style.borderLeft = '4px solid #cbd5e1';
                card.innerHTML = `
                    <div class="bed-header">
                        <span class="bed-number">Leito ${String(bed.id).padStart(2, '0')}</span>
                        <span class="bed-status" style="background-color: #f1f5f9; color: var(--text-muted);">Disponível</span>
                    </div>
                    <div class="patient-info" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 200px;">
                        <i class="fa-solid fa-bed" style="font-size: 3rem; color: #cbd5e1; margin-bottom: 1rem;"></i>
                        <button class="btn btn-primary" onclick="openAdmissionModal(${bed.id})">
                            <i class="fa-solid fa-user-plus"></i> Admitir Paciente
                        </button>
                    </div>
                `;
            } else {
                const age = calculateAge(bed.birthDate);
                let formattedDate = "---";
                if (bed.birthDate) {
                    const bDate = new Date(bed.birthDate);
                    formattedDate = isNaN(bDate) ? "---" : bDate.toLocaleDateString('pt-BR');
                }

                card.innerHTML = `
                    <div class="bed-header">
                        <span class="bed-number">Leito ${String(bed.id).padStart(2, '0')}</span>
                        <span class="bed-status">Ocupado</span>
                    </div>
                    <div class="patient-info">
                        <div class="patient-name">${bed.patient || 'Sem Nome'}</div>
                        
                        <div style="display: flex; gap: 1rem; margin-bottom: 1rem; font-size: 0.85rem; color: var(--text-muted); background: #f1f5f9; padding: 0.5rem; border-radius: 0.375rem;">
                            <div>
                                <i class="fa-solid fa-cake-candles" style="margin-right: 4px; color: var(--primary);"></i>
                                <strong>${formattedDate}</strong>
                            </div>
                            <div>
                                <i class="fa-solid fa-hourglass-half" style="margin-right: 4px; color: var(--primary);"></i>
                                <strong>${age} anos</strong>
                            </div>
                        </div>

                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 1rem; border: 1px solid #e2e8f0; border-radius: 0.375rem; padding: 0.5rem;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Admissão:</span>
                                <span style="font-weight: 600; color: var(--text-main);">${bed.admissionTime || '---'}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Transferência:</span>
                                <span style="font-weight: 600; color: var(--text-main);">${bed.transferTime || '---'}</span>
                            </div>
                             <div style="display: flex; justify-content: space-between;">
                                <span>Alta:</span>
                                <span style="font-weight: 600; color: var(--text-main);">${bed.dischargeTime || '---'}</span>
                            </div>
                        </div>

                        <div class="transfer-route">
                            <div class="unit-badge" style="width: 100%;">
                                <span class="unit-label">Origem</span>
                                <div style="font-weight: 600; font-size: 0.9rem; padding: 0.25rem 0;">${bed.origin || '---'}</div>
                            </div>
                            
                            <div style="display: flex; align-items: center; justify-content: center; padding: 0 0.5rem; color: var(--text-muted);">
                                <i class="fa-solid fa-arrow-right"></i>
                            </div>

                            <div class="unit-badge" style="width: 100%;">
                                <span class="unit-label">Destino</span>
                                <div style="font-weight: 600; font-size: 0.9rem; padding: 0.25rem 0; color: var(--primary);">${bed.destination || '---'}</div>
                            </div>
                        </div>

                        <div style="display: flex; gap: 0.5rem; margin-top: 1rem; border-top: 1px solid #f1f5f9; padding-top: 1rem;">
                            <button class="btn btn-secondary" style="flex: 1; font-size: 0.8rem; padding: 0.4rem;" onclick="openTransferModal(${bed.id})">
                                <i class="fa-solid fa-share-from-square" style="margin-right: 4px;"></i> Transferir
                            </button>
                            ${bed.dischargeTime === "---" || !bed.dischargeTime ?
                        `<button class="btn" style="flex: 1; font-size: 0.8rem; padding: 0.4rem; background-color: #fee2e2; color: #dc2626; border: 1px solid #fecaca;" onclick="handleDischarge(${bed.id})">
                                    <i class="fa-solid fa-door-open" style="margin-right: 4px;"></i> Alta
                                </button>` :
                        `<div style="flex: 1; text-align: center; font-size: 0.8rem; font-weight: 600; color: var(--success); padding: 0.4rem; background: #dcfce7; border-radius: 0.375rem;">
                                    Alta Realizada
                                </div>`
                    }
                        </div>
                    </div>
                `;
            }

            container.appendChild(card);
        } catch (err) {
            console.error("Error rendering bed card:", bed, err);
        }
    });

    updateOccupancyStats();
}

function updateOccupancyStats() {
    const occupiedCount = bedsData.filter(b => b.status === 'occupied').length;
    const totalCount = bedsData.length;

    const statsElement = document.getElementById('occupied-beds-count');
    if (statsElement) {
        statsElement.textContent = `${occupiedCount}/${totalCount}`;
    }
}

function renderHistory() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (patientHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">Nenhum registro encontrado.</td></tr>';
        return;
    }

    patientHistory.forEach(entry => {
        let badgeClass = '';
        if (entry.type === 'Admissão') badgeClass = 'badge-admission';
        else if (entry.type === 'Transferência') badgeClass = 'badge-transfer';
        else if (entry.type === 'Alta') badgeClass = 'badge-discharge';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${entry.timestamp}</td>
            <td style="font-weight: 500;">${entry.patient}</td>
            <td><span class="history-badge ${badgeClass}">${entry.type}</span></td>
            <td style="color: var(--text-muted);">${entry.details}</td>
            <td><div style="display: flex; align-items: center; gap: 6px;"><div class="avatar" style="width: 24px; height: 24px; font-size: 0.7rem;">${entry.user}</div></div></td>
        `;
        tbody.appendChild(row);
    });
}

function renderPatientList() {
    const tbody = document.getElementById('patient-list-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    bedsData.forEach(bed => {
        const row = document.createElement('tr');

        let statusBadge = '';
        let patientName = '';
        let origin = '---';
        let destination = '---';
        let timeIn = '---';

        if (bed.status === 'occupied') {
            statusBadge = '<span class="history-badge" style="background-color: #fecaca; color: #991b1b;">Ocupado</span>';
            patientName = `<div style="font-weight: 600; color: var(--text-main);">${bed.patient}</div><div style="font-size: 0.75rem; color: var(--text-muted);">${bed.birthDate ? calculateAge(bed.birthDate) + ' anos' : ''}</div>`;
            origin = bed.origin;
            destination = bed.destination;
            timeIn = bed.admissionTime;
        } else {
            statusBadge = '<span class="history-badge" style="background-color: #f1f5f9; color: var(--text-muted);">Disponível</span>';
            patientName = '<span style="color: var(--text-muted); font-style: italic;">---</span>';
        }

        row.innerHTML = `
            <td style="font-weight: 600;">Leito ${String(bed.id).padStart(2, '0')}</td>
            <td>${statusBadge}</td>
            <td>${patientName}</td>
            <td>${origin}</td>
            <td>${destination}</td>
            <td>${timeIn}</td>
        `;
        tbody.appendChild(row);
    });
}
