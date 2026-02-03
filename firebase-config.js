import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyA_wPDmboUvcQKJ11uIGM7E0yAiL3MhBo0",
    authDomain: "nexus-3d8cf.firebaseapp.com",
    projectId: "nexus-3d8cf",
    storageBucket: "nexus-3d8cf.firebasestorage.app",
    messagingSenderId: "284948127695",
    appId: "1:284948127695:web:62c37a50a2772fb3ca7cba",
    measurementId: "G-25WXPFTK7Z"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
