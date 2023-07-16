var express = require('express');
var app = express();
const { MongoClient } = require('mongodb');

var bodyParser = require('body-parser')
app.use( bodyParser.json() );
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const connectionString = process.env.ATLAS_URI || "mongodb://127.0.0.1:27017";

const client = new MongoClient(connectionString);

app.set('view engine', 'ejs');

app.get('/', function(req, res) {
    res.render('pages/index');
});

app.get('/main', function (req,res) {
    res.render('pages/list')
});

app.post('/data', async  function (req,res) {
    let patients = [];
    let doctors = [];
    let appointments = [];
    const db = await getConnection(client);
    const prepareData = await unparseStrings(req.body);
    let patientCollection = await db.collection("patients");
    let doctorCollection = await db.collection("doctors");
    let appointmentCollection = await db.collection("appointments");
    for (const patient in prepareData.patients) {
        if (prepareData.patients[patient] !== undefined) {
            patients.push(await patientCollection.insertOne(prepareData.patients[patient]));
        }
    }
    for (const doctor in prepareData.doctors) {
        if (prepareData.doctors[doctor] !== undefined) {
            doctors.push(await doctorCollection.insertOne(prepareData.doctors[doctor]));
        }
    }
    for (const appointment in prepareData.appointments) {
        if (prepareData.appointments[appointment] !== undefined) {
            appointments.push(await appointmentCollection.insertOne(prepareData.appointments[appointment]));
        }
    }

    patients.push(await patientCollection.aggregate().toArray());
    doctors.push(await doctorCollection.aggregate().toArray());
    appointments.push(await appointmentCollection.aggregate().toArray());
    res.render('pages/list', {});
});

app.get('/data', async function (req,res) {
    const db = await getConnection(client);
    const patientCollection = db.collection("patients");
    const doctorCollection = db.collection("doctors");
    const appointmentCollection = db.collection("appointments");
    await patientCollection.drop();
    await doctorCollection.drop();
    await appointmentCollection.drop();

    res.send(result).status(200);
});
app.get('/test', (req, res) => {
    res.write('This is the first part of the response. ');
    res.write('And here is the second part of the response.');
    res.end(); // Call res.end() to complete the response
});

app.get('/get-data', async function (req,res) {
    const db = await getConnection(client);
    const patientCollection = db.collection("patients");
    const doctorCollection = db.collection("doctors");
    const appointmentCollection = db.collection("appointments");

    let patients = await patientCollection.find({})
        .limit(50)
        .toArray();
    let doctors = await doctorCollection.find({})
        .limit(50)
        .toArray();
    let appointments = await appointmentCollection.find({})
        .limit(50)
        .toArray();

    let patientIds = [];
    for (const appointment in appointments) {
        const patient = patients.find(f => f.id === appointments[appointment].id_patient);
        const doctor = doctors.find(f => f.id === appointments[appointment].id_doctor);
        const patientTime = patient.time?.split('-');
        const doctorTime = doctor.time?.split('-');
        const isAvailable = await checkIsAvaible(patientTime, doctorTime, appointments[appointment].time);
        if (patient && doctor && isAvailable) {
            appointments[appointment].color = "green"
        } else {
            appointments[appointment].color = "red"
        }
        if (patientIds.find(f => f.id === appointments[appointment].id_patient)) {
            const conflictPatientId = patientIds.findIndex(f => f.id === appointments[appointment].id_patient);
            appointments[conflictPatientId].color = "yellow"
            appointments[appointment].color = "yellow"
        }
        patientIds.push({id: appointments[appointment].id_patient})
    }

    const newAppointments = await changeAppointments(appointments, patients, doctors);

    res.render('pages/table', { appointments, newAppointments })
});

async function changeAppointments(appointments, patients, doctors) {
    return rewriteSchedule(appointments, patients, doctors);
}

function rewriteSchedule(appointments, patients, doctors) {
    let bestSchedule = null; // Найкращий знайдений варіант графіку
    let maxGreenCount = 0; // Максимальна кількість зелених прийомів
    let minBlueCount = Infinity; // Мінімальна кількість синіх прийомів

    // Перебір усіх можливих комбінацій прийомів
    for (let i = 0; i < doctors.length; i++) {
        const doctor = doctors[i];

        for (let j = 0; j < patients.length; j++) {
            const patient = patients[j];
            const patientTime = patient.time?.split('-');
            const doctorTime = doctor.time?.split('-');

            if (isPatientAvailable(patientTime, doctorTime)) {
                const schedule = createSchedule(appointments, doctor, patient);

                const greenCount = countGreenAppointments(schedule);
                const blueCount = countBlueAppointments(schedule);

                if (greenCount > maxGreenCount || (greenCount === maxGreenCount && blueCount < minBlueCount)) {
                    bestSchedule = schedule;
                    maxGreenCount = greenCount;
                    minBlueCount = blueCount;
                }
            }
        }
    }

    console.log(maxGreenCount);
    console.log(minBlueCount);
    return bestSchedule;
}

// Перевірити доступність пацієнта для лікаря
function isPatientAvailable(patient, doctor) {
    return (
        patient[0] <= doctor[1] &&
        patient[1] >= doctor[0]
    );
}

// Створити графік прийомів для пацієнта і лікаря
function createSchedule(appointments, doctor, patient) {
    const schedule = [...appointments];

    for (let i = 0; i < schedule.length; i++) {
        const appointment = schedule[i];

        if (appointment.id_doctor === doctor.id) {
            appointment.id_patient = patient.id;
        }
    }

    return schedule;
}

// Порахувати кількість зелених прийомів в графіку
function countGreenAppointments(schedule) {
    let greenCount = 0;

    for (let i = 0; i < schedule.length; i++) {
        const appointment = schedule[i];

        if (isGreenAppointment(appointment)) {
            greenCount++;
        }
    }

    return greenCount;
}

// Перевірити, чи є прийом зеленим
function isGreenAppointment(appointment) {
    return appointment.id_patient !== undefined;
}

// Порахувати кількість синіх прийомів в графіку
function countBlueAppointments(schedule) {
    let blueCount = 0;

    for (let i = 0; i < schedule.length; i++) {
        const appointment = schedule[i];

        if (isBlueAppointment(appointment)) {
            blueCount++;
        }
    }

    return blueCount;
}

// Перевірити, чи є прийом синім
function isBlueAppointment(appointment) {
    return appointment.id_patient === undefined && appointment.time !== undefined;
}

async function unparseStrings (req) {
    let preparePatients = [];
    let prepareDoctors = [];
    let prepareAppointments = [];
    let patients = req.patients.split('\r\n');
    let doctors = req.doctors.split('\r\n');
    let appointments = req.appointments.split('\r\n');
     for (let patient in patients) {
         const value = patients[patient].split(', ');
         
         preparePatients[patient] = {
             id: value[0],
             time: value[1],
             name: value[2] || undefined,
             date: value[3] || undefined
         }
     }
    for (let doctor in doctors) {
        const value = doctors[doctor].split(', ');
        prepareDoctors[doctor] = {
            id: value[0],
            time: value[1],
            name: value[2] || undefined,
            date: value[3] || undefined
        }
    }
    for (let appointment in appointments) {
        const value = appointments[appointment].split(', ');
        prepareAppointments[appointment] = {
            id_patient: value[0],
            id_doctor: value[1],
            time: value[2] || undefined
        }
    }
    return {
        patients: preparePatients,
        doctors: prepareDoctors,
        appointments: prepareAppointments
    }
}

async function checkIsAvaible(patientTime, doctorTime, appointTime) {
    return (
        patientTime[0] <= doctorTime[1] && patientTime[1] >= doctorTime[0]) &&
        (appointTime >= doctorTime[0] && appointTime < doctorTime[1] ||
            appointTime >= patientTime[0] && appointTime < patientTime[1]);
}

async function getConnection(client) {
    let conn;
    try {
        conn = await client.connect();
    } catch(e) {
        console.error(e);
    }

    return conn.db("test");
}

app.listen(8080);
console.log('Server is listening on port 8080');