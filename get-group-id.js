const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox'],
  }
});

client.on('qr', (qr) => {
  console.log('QR-Code scannen mit WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('Client ist bereit!');
  
  try {
    const chats = await client.getChats();
    const groups = chats.filter(chat => chat.isGroup);
    
    console.log('\n=== DEINE WHATSAPP GRUPPEN ===');
    groups.forEach((group, index) => {
      console.log(`\n[${index + 1}] ${group.name}`);
      console.log(`ID: ${group.id._serialized}`);
    });
    
    console.log('\n\nKopiere die ID deiner Klassengruppe und füge sie in die index.js ein.');
    console.log('Zeile, die geändert werden muss:');
    console.log('const GRUPPENID = \'HIER_GRUPPE_ID_EINFÜGEN\'; -> const GRUPPENID = \'123456789@g.us\';\n');
    
    // Nach dem Auflisten der Gruppen den Client beenden
    console.log('Beende Client...');
    setTimeout(() => {
      process.exit(0);
    }, 5000);
  } catch (error) {
    console.error('Fehler beim Abrufen der Chats:', error);
    process.exit(1);
  }
});

client.on('auth_failure', (msg) => {
  console.error('Authentifizierung fehlgeschlagen:', msg);
  process.exit(1);
});

// Client initialisieren
console.log('Starte WhatsApp-Client zum Abrufen der Gruppen-IDs...');
client.initialize(); 