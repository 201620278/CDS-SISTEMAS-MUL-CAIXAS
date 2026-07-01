const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./banco/mercadao.db');

db.all("PRAGMA table_info(usuarios)", (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }

    console.table(rows);

    db.all("SELECT id, username, role FROM usuarios", (err2, usuarios) => {
        if (err2) {
            console.error(err2);
        } else {
            console.table(usuarios);
        }

        db.close();
    });
});
