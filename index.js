const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Gruppenchat-ID aus der Umgebungsvariable oder fallback auf einen Standardwert
const GRUPPENID = process.env.WHATSAPP_GROUP_ID || '120363327832370193@g.us';

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
  const timeOfDay = process.env.TIME_OF_DAY || 'morning';
  
  if (!dayData) {
    return "Keine Informationen für heute verfügbar.";
  }
  
  let greeting = '';
  if (timeOfDay === 'morning') {
    greeting = `*Guten Morgen 10HBFI! - ${currentDay}*\n\n`;
  } else {
    greeting = `*Guten Nachmittag 10HBFI! - ${currentDay}*\n\n`;
  }
  
  let message = greeting;
  message += `*${dayData.message}*\n\n`;
  
  if (dayData.subjects && dayData.subjects.length > 0) {
    dayData.subjects.forEach(subject => {
      message += `• ${subject}\n`;
    });
  }
  
  message += "\nEine automatische Nachricht deines Klassen-Bots.";
  
  return message;
}

// Funktion zum Erstellen einer Nachricht mit dem Wochenplan
function createWeeklyMessage() {
  const schedule = getSchedule();
  const currentDay = getCurrentDay();
  const timeOfDay = process.env.TIME_OF_DAY || 'morning';
  
  let greeting = '';
  if (timeOfDay === 'morning') {
    greeting = `*Guten Morgen 10HBFI! - ${currentDay}*\n`;
  } else {
    greeting = `*Guten Nachmittag 10HBFI! - ${currentDay}*\n`;
  }
  
  let message = greeting;
  message += `*📅 WOCHENÜBERSICHT 📅*\n\n`;
  
  // Zuerst den aktuellen Tag anzeigen
  const dayData = schedule[currentDay];
  if (dayData) {
    message += `*HEUTE (${currentDay}):*\n`;
    message += `${dayData.message}\n`;
    
    if (dayData.subjects && dayData.subjects.length > 0) {
      dayData.subjects.forEach(subject => {
        message += `• ${subject}\n`;
      });
    }
    message += '\n';
  }
  
  // Dann die kommenden Tage (sortiert nach Wochentag)
  const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const currentDayIndex = days.indexOf(currentDay);
  
  message += `*KOMMENDE TAGE:*\n`;
  
  // Beginne mit dem nächsten Tag und gehe die Woche bis zum Ende durch
  for (let i = currentDayIndex + 1; i < days.length; i++) {
    const day = days[i];
    const dayInfo = schedule[day];
    
    if (dayInfo && dayInfo.subjects && dayInfo.subjects.length > 0) {
      message += `\n*${day}:*\n`;
      message += `• ${dayInfo.subjects[0]}\n`;
      
      // Falls es mehr als einen Eintrag gibt, einen Hinweis anzeigen
      if (dayInfo.subjects.length > 1) {
        message += `• und ${dayInfo.subjects.length - 1} weitere Einträge\n`;
      }
    }
  }
  
  // Falls wir mitten in der Woche sind, auch die Tage vom Anfang der nächsten Woche anzeigen
  if (currentDayIndex > 0) {
    message += `\n*NÄCHSTE WOCHE:*\n`;
    
    for (let i = 0; i < currentDayIndex; i++) {
      const day = days[i];
      const dayInfo = schedule[day];
      
      if (dayInfo && dayInfo.subjects && dayInfo.subjects.length > 0) {
        message += `\n*${day}:*\n`;
        message += `• ${dayInfo.subjects[0]}\n`;
        
        // Falls es mehr als einen Eintrag gibt, einen Hinweis anzeigen
        if (dayInfo.subjects.length > 1) {
          message += `• und ${dayInfo.subjects.length - 1} weitere Einträge\n`;
        }
      }
    }
  }
  
  message += "\n\nEine automatische Nachricht deines Klassen-Bots.";
  
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
    const message = createWeeklyMessage();
    
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