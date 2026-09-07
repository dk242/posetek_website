import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
import "firebase/compat/storage";
import "firebase/compat/functions";

const firebaseConfig = {
  apiKey: "AIzaSyBSfyXyhmD4kYGRSg-jOmGeLeOO8hX0-Gs",
  authDomain: "kickai-69dd0.firebaseapp.com",
  projectId: "kickai-69dd0",
  storageBucket: "kickai-69dd0.firebasestorage.app",
  messagingSenderId: "839600313930",
  appId: "1:839600313930:web:13b1e94c2c540561e3f8b3",
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db = firebase.firestore();
export const storage = firebase.storage();
export const cloud = firebase.app().functions("us-central1");
export default firebase;
