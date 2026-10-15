-- ============================================================
-- Migración: 2026_10_06_000001_license_registry
-- Base:  MySQL 8 / MariaDB 10.4+
-- Objetivo:
--   Licencias guardadas en la base (las instala el gestor de licencias, firmadas por el
--   proveedor: el programa solo confía en el texto firmado), registro de los equipos que
--   usan el sistema (detecta códigos de equipo clonados) y revocaciones firmadas.
--   Solo crea tablas nuevas.
--
-- Versión SQL Server: migrations-mssql/ (mismo nombre de archivo).
-- Forward-only. Ejecutar una sola vez, después de 2026_10_03_000001.
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE system_licenses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  license_text TEXT NOT NULL,
  license_id VARCHAR(40) NOT NULL,
  empresa VARCHAR(150) NULL DEFAULT NULL,
  equipos INT NOT NULL DEFAULT 1,
  vence DATE NULL DEFAULT NULL,
  emitida DATE NOT NULL,
  installed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_system_licenses_license (license_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE license_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  machine_code VARCHAR(12) NOT NULL,
  machine_name VARCHAR(120) NULL DEFAULT NULL,
  app_version VARCHAR(30) NULL DEFAULT NULL,
  ip_address VARCHAR(45) NULL DEFAULT NULL,
  first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP NULL DEFAULT NULL,
  conflict_name VARCHAR(120) NULL DEFAULT NULL,
  conflict_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_license_devices_machine (machine_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE license_revocations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  revocation_text TEXT NOT NULL,
  descripcion VARCHAR(200) NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
