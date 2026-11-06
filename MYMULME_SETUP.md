# MyMulMe Immich Development Setup

This repository is a personal development fork of [Immich](https://github.com/immich-app/immich) with the MyMulMe photo-finding portal and custom MyMulMe branding. Immich is licensed under AGPL-3.0; see [LICENSE](LICENSE) and the upstream [Immich documentation](https://docs.immich.app/).

These steps run the **development** stack on Windows with WSL 2 and Docker Desktop. This is for local development, not a public production deployment.

## What is included

- Immich photo and video management.
- MyMulMe-branded web UI and photo gallery styling.
- A live-camera MyMulMe portal at `/my-mulme`. It checks for blinks in the browser, captures a selfie, and searches the administrator's indexed photo library.
- MyMulMe results are returned to the signed-in user and are not added to an album.

## Requirements

- Windows 10 or 11 with WSL 2 and an Ubuntu distribution.
- Docker Desktop using the WSL 2 engine, with integration enabled for the Ubuntu distribution.
- Several GB of free disk space. The first image build and dependency downloads can take a while.
- Internet access for the initial Docker/dependency downloads and the face-landmarker model.

## 1. Prepare the local environment file

Open PowerShell at the repository root. If `docker/.env` does not exist, create it from the example:

```powershell
Copy-Item docker/example.env docker/.env
```

The example stores the photo library and database under `docker/library` and `docker/postgres`. Change `UPLOAD_LOCATION` and `DB_DATA_LOCATION` in `docker/.env` if you want different locations. Keep `docker/.env` private; it is local configuration and must not be committed.

## 2. Start Immich

Run this in PowerShell, replacing the path only if your repository is elsewhere:

```powershell
$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
Set-Location '\\wsl.localhost\Ubuntu-26.04\home\vaibh\projects\immich'
& $docker compose --env-file docker/.env -f docker/docker-compose.dev.yml up --build
```

Leave this terminal open while using the application. The first build downloads and builds the development services; later starts reuse cached images and dependencies.

Open [http://localhost:3000](http://localhost:3000). Complete the first-user setup; the first account becomes the administrator. Sign in and open [http://localhost:3000/my-mulme](http://localhost:3000/my-mulme).

## 3. Set up MyMulMe photo matching

1. Upload photos to Immich under the administrator account.
2. Enable facial recognition in the Immich administration settings and wait for the library's face jobs to finish.
3. Sign in to MyMulMe with an Immich account that has asset-read permission.
4. Open the camera, allow browser camera access, face the camera, and blink twice. The portal captures the live frame and starts matching automatically.

The selfie is uploaded for matching and processed through a temporary server file that is deleted afterward. It is not saved as an Immich library asset. The blink check is a basic heuristic; it does not reliably prevent prerecorded or synthetic video.

## Stop and restart

Press **Ctrl+C** in the PowerShell window running Compose to stop the foreground stack. To start it later, run the same `docker compose ... up --build` command again.

To stop the stack from another PowerShell window without deleting its data:

```powershell
& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose --env-file docker/.env -f docker/docker-compose.dev.yml down
```

Do not add `-v` to `down` if you want to keep the database volumes. Your photo and database paths are also controlled by `UPLOAD_LOCATION` and `DB_DATA_LOCATION` in `docker/.env`.

## Useful addresses

- Immich web UI: `http://localhost:3000`
- MyMulMe portal: `http://localhost:3000/my-mulme`
- Immich API/mobile server endpoint on this laptop: `http://localhost:2283/api`

`localhost` only works on the device running Docker. For a phone on the same Wi-Fi, use the laptop's LAN address instead of `localhost`. Camera access from another device generally requires HTTPS. For remote access, use a domain and HTTPS reverse proxy; do not expose this development stack directly to the public internet.

## Privacy and access

The matching endpoint requires an authenticated Immich account with asset-read permission. It compares the selfie against the administrator's indexed library and returns matching thumbnails. Only provide access to people you trust, and do not make this development server an anonymous public service.

## Troubleshooting

- **Docker command not found in PowerShell:** use the full Docker executable path shown above.
- **Docker engine pipe missing:** start Docker Desktop, wait until its engine is running, then retry.
- **Web page does not load after changing Vite configuration:** restart the web container:

  ```powershell
  & 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' restart immich_web
  ```

- **Detector or model cannot load:** keep internet access available to the Docker development environment so it can download the face-landmarker model. The MediaPipe JavaScript package and WASM files are served by the web app.
- **Matching returns no photos:** confirm facial recognition is enabled and its jobs completed for the administrator's library.
- **View service logs:**

  ```powershell
  & 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' logs --tail 100 immich_web
  & 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' logs --tail 100 immich_server
  ```

For upstream Immich developer setup and project architecture, see [docs/docs/developer/setup.md](docs/docs/developer/setup.md).
