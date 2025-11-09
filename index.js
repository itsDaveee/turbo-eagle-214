// index.js

const express = require('express');
const app = express();
const axios = require('axios'); // Pour envoyer des réponses

// Port sur lequel le serveur doit écouter (nécessaire pour Render/Docker)
const PORT = process.env.PORT || 3000;

// Token que vous DEVEZ définir dans les variables d'environnement de Render
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN; 
const WA_ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_ID;

// Middleware pour analyser les requêtes JSON (crucial pour le POST)
app.use(express.json());

// ------------------------------------------------------------------
// A. ENDPOINT POUR LA VÉRIFICATION DU WEBHOOK (MÉTHODE GET)
// Le chemin doit être /webhook pour correspondre à la configuration Meta
// ------------------------------------------------------------------
app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    // Vérification du mode et du jeton
    if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
        // Succès : Renvoyer le challenge (clé unique) à Meta avec statut 200
        console.log('Webhook Verified!');
        res.status(200).send(challenge);
    } else {
        // Échec : Jeton incorrect ou mode invalide
        console.error('Webhook Verification Failed!');
        res.sendStatus(403);
    }
});

// ------------------------------------------------------------------
// B. ENDPOINT POUR LA RÉCEPTION DES MESSAGES (MÉTHODE POST)
// ------------------------------------------------------------------
app.post('/webhook', (req, res) => {
    // Renvoyer le statut 200 (OK) immédiatement pour éviter les timeouts
    res.sendStatus(200); 

    let body = req.body;

    if (body.object === 'whatsapp_business_account') {
        body.entry.forEach(entry => {
            entry.changes.forEach(change => {
                if (change.value.messages) {
                    change.value.messages.forEach(message => {
                        const userText = message.text.body;
                        const userFrom = message.from; // Numéro de l'utilisateur

                        console.log(`Message reçu de ${userFrom}: ${userText}`);
                        
                        // ICI : Appelez la fonction de réponse
                        sendWhatsAppMessage(userFrom, "J'ai bien reçu votre message : " + userText);
                    });
                }
            });
        });
    }
});

// ------------------------------------------------------------------
// C. FONCTION D'ENVOI DE RÉPONSE (Utilise le WA_ACCESS_TOKEN)
// ------------------------------------------------------------------
function sendWhatsAppMessage(to, text) {
    if (!WA_ACCESS_TOKEN || !WA_PHONE_ID) {
        console.error('Tokens or Phone ID are missing. Cannot send message.');
        return;
    }

    const url = `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`;
    
    axios.post(url, {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: {
            body: text
        }
    }, {
        headers: {
            'Authorization': `Bearer ${WA_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        }
    })
    .then(response => console.log('Message envoyé avec succès:', response.data))
    .catch(error => console.error('Erreur lors de l\'envoi:', error.response ? error.response.data : error.message));
}

// ------------------------------------------------------------------
// DÉMARRAGE DU SERVEUR
// ------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
