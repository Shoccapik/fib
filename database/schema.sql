CREATE DATABASE IF NOT EXISTS fib_portal;
USE fib_portal;

CREATE TABLE users(
id INT AUTO_INCREMENT PRIMARY KEY,
username VARCHAR(50),
password TEXT,
grade VARCHAR(50),
accreditation INT
);

INSERT INTO users (username, password, grade, accreditation)
VALUES ("admin", "$2b$10$lcHzAI.qj89xvofR1.s4VO433/DlyKXUgIhv4Q5kHhHqIZVKfA.72", "user", 1);

ALTER TABLE users ADD COLUMN grade_title VARCHAR(50) DEFAULT NULL;

UPDATE users SET grade_title = "Director" WHERE username = "admin";

CREATE TABLE citizens(
id INT AUTO_INCREMENT PRIMARY KEY,
nom VARCHAR(50),
prenom VARCHAR(50),
dob DATE,
phone VARCHAR(30),
job VARCHAR(100),
affiliation VARCHAR(100),
permits TEXT,
owned_vehicles TEXT,
residences TEXT,
registered_weapons TEXT,
photo_paths TEXT,
wanted BOOLEAN NOT NULL DEFAULT FALSE,
dangerous BOOLEAN NOT NULL DEFAULT FALSE,
group_id INT
);

CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(100),
    content TEXT,
    level INT,
    group_name VARCHAR(100),
        report_type VARCHAR(30) NOT NULL DEFAULT 'Compte-rendu',
        claims TEXT,
        operating_places TEXT,
        hideout VARCHAR(255),
        group_id INT,
        agent_id INT,
        personnes_concernees TEXT,
        agents_concernes TEXT,
        vehicules TEXT,
        plaques TEXT,
        armes TEXT,
        numeros_serie TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS groups(
id INT AUTO_INCREMENT PRIMARY KEY,
name VARCHAR(100) NOT NULL UNIQUE,
claims TEXT,
operating_places TEXT,
hideout VARCHAR(255),
created_by INT,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages(
id INT AUTO_INCREMENT PRIMARY KEY,
sender VARCHAR(50),
receiver VARCHAR(50),
subject VARCHAR(100),
    group_id INT,
content TEXT,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE service_logs(
id INT AUTO_INCREMENT PRIMARY KEY,
user_id INT,
start_time DATETIME,
end_time DATETIME,
pause_time DATETIME
);

CREATE TABLE logs(
id INT AUTO_INCREMENT PRIMARY KEY,
action TEXT,
actor_username VARCHAR(50),
authorization VARCHAR(20),
target_type VARCHAR(30),
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

