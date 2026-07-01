const db = require('./database');

db.get(
    "SELECT * FROM usuarios WHERE username = ?",
    ["Diego"],
    (err, row) => {
        console.log(err);
        console.log(row);
        process.exit();
    }
);
