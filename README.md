# WhatsApp Klassen-Benachrichtigungs-Bot

Dieser Bot sendet automatisch jeden Morgen um 7 Uhr eine Nachricht mit dem Tagesplan an deine WhatsApp-Gruppe.

## Wie funktioniert es?

1. Der Bot läuft auf GitHub Actions (in der Cloud)
2. Die Nachrichten werden aus der `schedule.json` geladen
3. Die Ausführung erfolgt jeden Tag um 7 Uhr morgens
4. Es kostet nichts und läuft auch, wenn dein Computer ausgeschaltet ist

## Einrichtung

### 1. Repository erstellen
1. Erstelle ein privates GitHub-Repository
2. Lade alle Dateien aus diesem Ordner hoch

### 2. WhatsApp-Verbindung einrichten
1. Führe den Bot lokal aus, um die WhatsApp-Verbindung herzustellen:
   ```bash
   npm install
   node index.js
   ```
2. Scanne den QR-Code mit deinem WhatsApp
3. Jetzt ist der Bot mit deinem WhatsApp verbunden

### 3. Gruppen-ID finden
1. Nach der erfolgreichen Verbindung, öffne eine neue JavaScript-Datei:
   ```javascript
   // get-group-id.js
   const { Client, LocalAuth } = require('whatsapp-web.js');
   
   const client = new Client({
     authStrategy: new LocalAuth(),
   });
   
   client.on('qr', (qr) => {
     console.log('QR Code:', qr);
   });
   
   client.on('ready', async () => {
     console.log('Client ist bereit!');
     const chats = await client.getChats();
     const groups = chats.filter(chat => chat.isGroup);
     
     console.log('Deine Gruppen:');
     groups.forEach(group => {
       console.log(`Name: ${group.name} | ID: ${group.id._serialized}`);
     });
     
     process.exit(0);
   });
   
   client.initialize();
   ```
2. Führe diese Datei aus: `node get-group-id.js`
3. Kopiere die ID deiner Klassengruppe
4. Aktualisiere die `GRUPPENID` Variable in der `index.js` Datei

### 4. Stundenplan bearbeiten
1. Bearbeite die `schedule.json` Datei, um deinen eigenen Stundenplan einzutragen

### 5. Hochladen der WhatsApp-Session
Nach der lokalen Einrichtung:
1. Im Projektordner sollte ein Ordner `.wwebjs_auth` entstanden sein
2. Lade diesen Ordner mit in dein GitHub-Repository hoch
3. Alternativ: Richte den WhatsApp-Bot direkt in GitHub Actions ein, indem du den Workflow manuell auslöst und den QR-Code in den Logs scannst

## Anpassungen

Du kannst den Stundenplan in der `schedule.json` Datei jederzeit ändern. Einfach die Datei im GitHub-Repository bearbeiten und die Änderungen werden automatisch wirksam.

## Fehlerbehebung

Falls Probleme auftreten:
1. Überprüfe die GitHub Actions Logs
2. Bei WhatsApp-Verbindungsproblemen: Lösche den `.wwebjs_auth`-Ordner und richte die Verbindung neu ein
3. Bei Fragen oder Problemen öffne ein Issue in deinem Repository 