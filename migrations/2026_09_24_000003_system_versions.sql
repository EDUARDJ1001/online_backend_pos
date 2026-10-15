-- ============================================================
-- @actualiza-datos: crea el contador de versión de permisos.
-- Migración: 2026_09_24_000003_system_versions
-- Base:  facturacion_multiempresa (MySQL 8 / MariaDB 10.4+)
-- Objetivo:
--   Aviso de cambios entre cajas que corren su propio programa contra la misma
--   base: cada tipo de dato en memoria (p. ej. permisos) tiene un número de
--   versión que sube al cambiar; cada programa lo revisa cada pocos segundos y,
--   si cambió, vuelve a leer de la base.
--
-- Forward-only. Ejecutar una sola vez, después de 2026_09_24_000002.
-- ============================================================

USE facturacion_multiempresa;

SET NAMES utf8mb4;

CREATE TABLE system_versions (
  version_key VARCHAR(40) NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (version_key)
) ENGINE=InnoDB;

-- permissions: permisos por rol, rol y estado de cada usuario.
INSERT INTO system_versions (version_key, version) VALUES ('permissions', 1);

-- ============================================================
-- Fin de migración.
-- +tabla system_versions
-- ============================================================
