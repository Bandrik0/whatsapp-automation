const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Konfiguration
const SCHULPORTAL_URL = 'https://start.schulportal.hessen.de/';
const OUTPUT_FILE = path.join(__dirname, 'schedule.json');
const CSV_FILE = process.env.CSV_FILE || path.join(__dirname, 'schulkalender.csv');

// Login-Daten aus Umgebungsvariablen lesen (werden als GitHub Secrets gespeichert)
const USERNAME = process.env.SCHULPORTAL_USERNAME;
const PASSWORD = process.env.SCHULPORTAL_PASSWORD;

// Alternative Funktion, die direkt aus der CSV-Datei liest
async function loadFromCSV() {
  console.log('Lade Daten aus CSV-Datei...');
  
  return new Promise((resolve, reject) => {
    const results = [];
    
    if (!fs.existsSync(CSV_FILE)) {
      return reject(new Error(`CSV-Datei nicht gefunden: ${CSV_FILE}`));
    }
    
    fs.createReadStream(CSV_FILE)
      .pipe(csv({
        separator: ';',
        headers: ['Titel', 'Art', 'Von_Datum', 'Von_Uhrzeit', 'Bis_Datum', 'Bis_Uhrzeit', 'Beschreibung', 'Ort', 'Verantwortlich'],
        skipLines: 1
      }))
      .on('data', (data) => results.push(data))
      .on('end', () => {
        console.log(`${results.length} Einträge aus CSV geladen.`);
        resolve(results);
      })
      .on('error', (error) => reject(error));
  });
}

// Funktion zum Einloggen ins Schulportal (als Backup behalten wir diese Funktion)
async function loginToSchulportal(page) {
  console.log('Starte Login-Prozess...');
  
  await page.goto(SCHULPORTAL_URL);
  
  // Warten bis die Login-Seite geladen ist
  await page.waitForSelector('#schulportal-login');
  
  // Login-Daten eingeben
  await page.type('#benutzername', USERNAME);
  await page.type('#passwort', PASSWORD);
  
  // Login-Button klicken
  await page.click('button[type="submit"]');
  
  // Warten bis Dashboard geladen ist
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  
  console.log('Login erfolgreich!');
}

// Funktion zum Konvertieren der CSV-Daten in das schedule.json Format
function convertCSVToScheduleFormat(csvData) {
  console.log('Konvertiere CSV-Daten in schedule.json Format...');
  
  // Erstelle ein Grundgerüst der schedule.json
  const schedule = {
    "Montag": {
      "message": "📅 *TERMINÜBERSICHT FÜR DIESE WOCHE* 📅",
      "subjects": []
    },
    "Dienstag": {
      "message": "📚 *ANSTEHENDE KLAUSUREN* 📝",
      "subjects": []
    },
    "Mittwoch": {
      "message": "🌟 *MITTE DER WOCHE* 🌟",
      "subjects": []
    },
    "Donnerstag": {
      "message": "🗓️ *KOMMENDE FEIERTAGE* 🎉",
      "subjects": []
    },
    "Freitag": {
      "message": "📝 *FREITAGS-KLAUSUREN* 📝",
      "subjects": []
    },
    "Samstag": {
      "message": "🎉 *WOCHENENDE!* 🎉",
      "subjects": []
    },
    "Sonntag": {
      "message": "🔄 *WOCHE VORAUSPLANEN* 📆",
      "subjects": []
    }
  };
  
  // Verarbeite jeden Eintrag aus der CSV
  for (const entry of csvData) {
    try {
      // Formatiere das Datum (Von_Datum: "01.01.2025")
      const dateStr = entry.Von_Datum;
      if (!dateStr || dateStr.split('.').length !== 3) {
        console.log(`Überspringe Eintrag ohne gültiges Datum: ${entry.Titel}`);
        continue;
      }
      
      const date = new Date(
        parseInt(dateStr.split('.')[2]), // Jahr
        parseInt(dateStr.split('.')[1]) - 1, // Monat (0-basiert)
        parseInt(dateStr.split('.')[0]) // Tag
      );
      
      // Bestimme den Wochentag
      const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
      const dayName = days[date.getDay()];
      
      // Formatiere die Uhrzeit, falls vorhanden
      let timeStr = '';
      if (entry.Von_Uhrzeit && entry.Von_Uhrzeit !== '00:00' && entry.Bis_Uhrzeit && entry.Bis_Uhrzeit !== '23:59') {
        timeStr = ` (${entry.Von_Uhrzeit}-${entry.Bis_Uhrzeit})`;
      }
      
      // Formatiere den Eintrag je nach Art
      let formattedEntry = '';
      
      if (entry.Art === 'Klausuren' || entry.Titel.toLowerCase().includes('klausur')) {
        formattedEntry = `📝 *${dateStr}${timeStr}:* ${entry.Titel}`;
      } else if (entry.Art === 'Ferien & freie Tage' || entry.Titel.toLowerCase().includes('ferien') || entry.Titel.toLowerCase().includes('frei')) {
        formattedEntry = `🎊 *${dateStr}:* ${entry.Titel} (schulfrei)`;
      } else {
        formattedEntry = `📌 *${dateStr}${timeStr}:* ${entry.Titel}`;
      }
      
      // Füge Beschreibung und Ort hinzu, wenn vorhanden
      if (entry.Beschreibung) {
        formattedEntry += ` - ${entry.Beschreibung}`;
      }
      
      if (entry.Ort) {
        formattedEntry += ` (${entry.Ort})`;
      }
      
      // Füge den Eintrag zum entsprechenden Wochentag hinzu
      if (schedule[dayName]) {
        schedule[dayName].subjects.push(formattedEntry);
      } else {
        console.log(`Unbekannter Wochentag für Datum ${dateStr}: ${dayName}`);
      }
    } catch (error) {
      console.error(`Fehler beim Verarbeiten eines Eintrags: ${error.message}`, entry);
    }
  }
  
  return schedule;
}

// Hauptfunktion
async function updateSchedule() {
  console.log('Starte Aktualisierung des Schulkalenders...');
  
  try {
    // Versuche, die Daten aus der CSV-Datei zu laden
    const csvData = await loadFromCSV();
    
    // Konvertiere die Daten ins richtige Format
    const scheduleData = convertCSVToScheduleFormat(csvData);
    
    // Speichere die Daten
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(scheduleData, null, 2));
    
    console.log(`Kalenderdaten erfolgreich in ${OUTPUT_FILE} gespeichert!`);
  } catch (error) {
    console.error('Fehler bei der Aktualisierung des Kalenders:', error);
    process.exit(1);
  }
}

// Starte die Aktualisierung
updateSchedule(); 