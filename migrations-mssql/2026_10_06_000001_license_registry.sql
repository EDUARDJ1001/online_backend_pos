/* ============================================================
   Migración: 2026_10_06_000001_license_registry (SQL Server)
   Objetivo:
     Licencias guardadas en la base (las instala el gestor de licencias, firmadas por el
     proveedor: el programa solo confía en el texto firmado), registro de los equipos que
     usan el sistema (detecta códigos de equipo clonados) y revocaciones firmadas.
     Solo crea tablas nuevas.

   Versión MySQL: migrations/ (mismo nombre de archivo).
   ============================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

CREATE TABLE [dbo].[system_licenses] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [license_text] NVARCHAR(MAX) NOT NULL,
  [license_id] NVARCHAR(40) NOT NULL,
  [empresa] NVARCHAR(150) NULL,
  [equipos] INT NOT NULL CONSTRAINT [DF_system_licenses_equipos] DEFAULT 1,
  [vence] DATE NULL,
  [emitida] DATE NOT NULL,
  [installed_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_system_licenses_installed_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_system_licenses] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [uq_system_licenses_license] UNIQUE ([license_id])
);

CREATE TABLE [dbo].[license_devices] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [machine_code] NVARCHAR(12) NOT NULL,
  [machine_name] NVARCHAR(120) NULL,
  [app_version] NVARCHAR(30) NULL,
  [ip_address] NVARCHAR(45) NULL,
  [first_seen] DATETIME2(0) NOT NULL CONSTRAINT [DF_license_devices_first_seen] DEFAULT SYSUTCDATETIME(),
  [last_seen] DATETIME2(0) NULL,
  [conflict_name] NVARCHAR(120) NULL,
  [conflict_at] DATETIME2(0) NULL,
  CONSTRAINT [PK_license_devices] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [uq_license_devices_machine] UNIQUE ([machine_code])
);

CREATE TABLE [dbo].[license_revocations] (
  [id] BIGINT IDENTITY(1,1) NOT NULL,
  [revocation_text] NVARCHAR(MAX) NOT NULL,
  [descripcion] NVARCHAR(200) NULL,
  [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_license_revocations_created_at] DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_license_revocations] PRIMARY KEY CLUSTERED ([id])
);
