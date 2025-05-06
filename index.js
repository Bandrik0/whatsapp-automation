const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Gruppenchat-ID (muss nach Authentifizierung aktualisiert werden)
// Format ist normalerweise so: "49123456789-1234567890@g.us"
const GRUPPENID = 'HIER_GRUPPE_ID_EINFÜGEN';

// Funktion zum Laden des Stundenplans
function getSchedule() {
  const filePath = path.join(__dirname, 'schedule.json');
  const scheduleData = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(scheduleData);
}

// Funktion zum Ermitteln des aktuellen Wochentags
function getCurrentDay() {
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const dayIndex = new Date().getDay();
  return days[dayIndex];
}

// Funktion zum Erstellen der Nachricht für den aktuellen Tag
function createDailyMessage() {
  const schedule = getSchedule();
  const currentDay = getCurrentDay();
  const dayData = schedule[currentDay];
  
  if (!dayData) {
    return "Keine Informationen für heute verfügbar.";
  }
  
  let message = `*Guten Morgen 10HBFI! - ${currentDay}*\n\n`;
  message += `*${dayData.message}*\n\n`;
  
  if (dayData.subjects && dayData.subjects.length > 0) {
    dayData.subjects.forEach(subject => {
      message += `• ${subject}\n`;
    });
  }
  
  message += "\nEine automatische Nachricht deines Klassen-Bots.";
  
  return message;
}

// WhatsApp-Client initialisieren
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox'],
  }
});

// QR-Code für Authentifizierung anzeigen
client.on('qr', (qr) => {
  console.log('QR-Code scannen mit WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('Client ist bereit!');
  
  try {
    // Nachricht für heute erstellen und senden
    const message = createDailyMessage();
    
    // Prüfen ob es eine Testausführung ist oder eine geplante Ausführung
    if (process.env.SEND_MESSAGE === 'true') {
      await client.sendMessage(GRUPPENID, message);
      console.log('Nachricht erfolgreich gesendet!');
    } else {
      // Bei Testausführung nur in die Konsole ausgeben
      console.log('TEST-Modus: Nachricht würde gesendet werden:');
      console.log(message);
    }
    
    // Nach dem Senden den Client beenden
    console.log('Beende Client...');
    setTimeout(() => {
      process.exit(0);
    }, 5000);
  } catch (error) {
    console.error('Fehler beim Senden der Nachricht:', error);
    process.exit(1);
  }
});

client.on('auth_failure', (msg) => {
  console.error('Authentifizierung fehlgeschlagen:', msg);
  process.exit(1);
});

// Client initialisieren
console.log('Starte WhatsApp-Client...');
client.initialize(); 