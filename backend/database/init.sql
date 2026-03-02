-- Medical Books Table
CREATE TABLE IF NOT EXISTS medical_books (
    book_id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    authors TEXT,
    edition VARCHAR(50),
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_pages INT,
    total_chunks INT,
    status ENUM('processing', 'indexed', 'failed') DEFAULT 'processing',
    file_path VARCHAR(1000),
    INDEX idx_status (status),
    INDEX idx_upload_date (upload_date)
);

-- Query Logs Table
CREATE TABLE IF NOT EXISTS query_logs (
    query_id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(100),
    query_text TEXT NOT NULL,
    query_type VARCHAR(100),
    used_web_search BOOLEAN DEFAULT FALSE,
    response_time_ms INT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_timestamp (timestamp)
);

-- Web Search Cache Table
CREATE TABLE IF NOT EXISTS web_cache (
    cache_id VARCHAR(36) PRIMARY KEY,
    query_hash VARCHAR(64) UNIQUE NOT NULL,
    query_text TEXT,
    results_json JSON,
    credibility_scores JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    INDEX idx_query_hash (query_hash),
    INDEX idx_expires (expires_at)
);

-- Source Credibility Table
CREATE TABLE IF NOT EXISTS source_credibility (
    source_id VARCHAR(36) PRIMARY KEY,
    domain VARCHAR(255) UNIQUE NOT NULL,
    credibility_tier INT CHECK (credibility_tier IN (1, 2, 3)),
    is_blacklisted BOOLEAN DEFAULT FALSE,
    last_verified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_domain (domain)
);

-- Book Chunks Metadata
CREATE TABLE IF NOT EXISTS book_chunks (
    chunk_id VARCHAR(100) PRIMARY KEY,
    book_id VARCHAR(36),
    pinecone_id VARCHAR(100) UNIQUE NOT NULL,
    chunk_text TEXT,
    page_number INT,
    chapter VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES medical_books(book_id) ON DELETE CASCADE,
    INDEX idx_book_id (book_id),
    INDEX idx_pinecone_id (pinecone_id)
);

-- Insert Default Trusted Sources
INSERT IGNORE INTO source_credibility (source_id, domain, credibility_tier, is_blacklisted) VALUES
(UUID(), 'pubmed.ncbi.nlm.nih.gov', 1, FALSE),
(UUID(), 'who.int', 1, FALSE),
(UUID(), 'cdc.gov', 1, FALSE),
(UUID(), 'nih.gov', 1, FALSE),
(UUID(), 'mayoclinic.org', 2, FALSE),
(UUID(), 'clevelandclinic.org', 2, FALSE),
(UUID(), 'hopkinsmedicine.org', 2, FALSE),
(UUID(), 'medscape.com', 2, FALSE),
(UUID(), 'fda.gov', 3, FALSE),
(UUID(), 'nhs.uk', 3, FALSE);