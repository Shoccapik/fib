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
dob DATE
);

CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(100),
    content TEXT,
    level INT,
    agent_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages(
id INT AUTO_INCREMENT PRIMARY KEY,
sender INT,
receiver INT,
title VARCHAR(100),
content TEXT
);

CREATE TABLE service_logs(
id INT AUTO_INCREMENT PRIMARY KEY,
user_id INT,
start_time DATETIME,
end_time DATETIME
);

CREATE TABLE logs(
id INT AUTO_INCREMENT PRIMARY KEY,
action TEXT,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

