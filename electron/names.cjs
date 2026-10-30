// Copied from Home-Dashboard (server/names.js).
// Friendly app names for the sidebar. Unraid container names are whatever the
// template author picked ("binhex-sonarr", "qbittorrentvpn", "Plex-Media-Server"),
// so look the name up in a list of well-known apps, then try the image name,
// and only then fall back to tidying the container name itself.
const KNOWN = {
  adguardhome: 'AdGuard Home',
  audiobookshelf: 'Audiobookshelf',
  authelia: 'Authelia',
  bazarr: 'Bazarr',
  calibre: 'Calibre',
  calibreweb: 'Calibre-Web',
  codeserver: 'code-server',
  deluge: 'Deluge',
  delugevpn: 'Deluge VPN',
  duplicati: 'Duplicati',
  emby: 'Emby',
  embyserver: 'Emby',
  esphome: 'ESPHome',
  filebrowser: 'File Browser',
  flaresolverr: 'FlareSolverr',
  frigate: 'Frigate',
  gluetun: 'Gluetun',
  grafana: 'Grafana',
  heimdall: 'Heimdall',
  homarr: 'Homarr',
  homeassistant: 'Home Assistant',
  homedashboard: 'Home-Dashboard',
  immich: 'Immich',
  influxdb: 'InfluxDB',
  jackett: 'Jackett',
  jellyfin: 'Jellyfin',
  jellyseerr: 'Jellyseerr',
  kometa: 'Kometa',
  krusader: 'Krusader',
  lidarr: 'Lidarr',
  mariadb: 'MariaDB',
  mongodb: 'MongoDB',
  mongo: 'MongoDB',
  mosquitto: 'Mosquitto',
  mylar3: 'Mylar3',
  navidrome: 'Navidrome',
  netdata: 'Netdata',
  nextcloud: 'Nextcloud',
  nginx: 'NGINX',
  nginxproxymanager: 'Nginx Proxy Manager',
  npm: 'Nginx Proxy Manager',
  nodered: 'Node-RED',
  notifiarr: 'Notifiarr',
  nzbget: 'NZBGet',
  ombi: 'Ombi',
  organizr: 'Organizr',
  overseerr: 'Overseerr',
  paperlessngx: 'Paperless-ngx',
  photoprism: 'PhotoPrism',
  pihole: 'Pi-hole',
  plex: 'Plex',
  plexmediaserver: 'Plex',
  plexpass: 'Plex',
  pms: 'Plex',
  pmsdocker: 'Plex',
  portainer: 'Portainer',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  prometheus: 'Prometheus',
  prowlarr: 'Prowlarr',
  qbittorrent: 'qBittorrent',
  qbittorrentvpn: 'qBittorrent VPN',
  radarr: 'Radarr',
  readarr: 'Readarr',
  recyclarr: 'Recyclarr',
  redis: 'Redis',
  requestrr: 'Requestrr',
  sabnzbd: 'SABnzbd',
  sabnzbdvpn: 'SABnzbd VPN',
  scrutiny: 'Scrutiny',
  sonarr: 'Sonarr',
  swag: 'SWAG',
  syncthing: 'Syncthing',
  tailscale: 'Tailscale',
  tautulli: 'Tautulli',
  tdarr: 'Tdarr',
  traefik: 'Traefik',
  transmission: 'Transmission',
  unifi: 'UniFi',
  unificontroller: 'UniFi Controller',
  unifinetworkapplication: 'UniFi Network',
  unmanic: 'Unmanic',
  uptimekuma: 'Uptime Kuma',
  vaultwarden: 'Vaultwarden',
  watchtower: 'Watchtower',
  wireguard: 'WireGuard',
  zigbee2mqtt: 'Zigbee2MQTT',
};

// Publisher prefixes Unraid's Community Apps commonly put in front of names.
const PREFIX_RE = /^(binhex|linuxserver|lsio|hotio|ich777|jlesage|selfhosters)[-_.]/i;

function key(s) {
  return s.replace(PREFIX_RE, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// "lscr.io/linuxserver/sonarr:latest" -> "sonarr"
function imageRepo(image) {
  if (!image || image.startsWith('sha256:')) return null;
  const noTag = image.replace(/@.*$/, '').replace(/:[^/]*$/, '');
  return noTag.split('/').pop() || null;
}

// "sonarr-4k" -> "Sonarr 4k"; reports whether any word was a known app.
function tidy(name) {
  const words = name.replace(PREFIX_RE, '').split(/[-_.\s]+/).filter(Boolean);
  let known = false;
  const out = words.map((w) => {
    const app = KNOWN[key(w)];
    if (app) known = true;
    return app || (/[A-Z]/.test(w) ? w : w[0].toUpperCase() + w.slice(1));
  });
  return { text: out.join(' ') || name, known };
}

function displayName(name, image) {
  const fromName = KNOWN[key(name)];
  if (fromName) return fromName;
  const tidied = tidy(name);
  if (tidied.known) return tidied.text;
  const repo = imageRepo(image);
  return (repo && KNOWN[key(repo)]) || tidied.text;
}

module.exports = { displayName, imageRepo, key, tidy };
