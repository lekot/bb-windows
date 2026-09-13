# Public preview security review

The user authorized publication of the sanitized Windows candidate. The old
maintenance `main`, local remotes/configuration, ignored files and runtime data
are not publication inputs. Only `release/windows-candidate` is pushed as `main`.
Existing upstream MIT attribution is retained.

Gitleaks 8.30.1 scanned all 5,568 commits reachable from preview preparation
commit `b7dcb5a6d`, approximately 459 MB of historical changes. The downloaded
scanner was checked against the official release SHA-256 checksum. Scanning ran
locally with the default rules, an empty ignore file, inline allow-comments
disabled, and redacted reports. No source or scan report was uploaded to a
third-party scanning service.

Eight findings were reviewed individually:

| Finding | Classification |
| --- | --- |
| ZCode quota test API-key literal | Synthetic fixture used with a mocked fetch implementation, not an account credential |
| Account-pool localhost private key | Existing upstream TLS test fixture, not a certificate/key from this Windows machine |
| Three Claude OAuth client-ID occurrences | Existing upstream public OAuth client identifiers, not client secrets or access tokens |
| Mobile App Store Connect issuer ID | Existing upstream identifier; the private API-key file is not included |
| Cloud development secret | Existing upstream fixed local-development value for the localhost dev helper; not a production credential and not used by the Windows launcher |
| PostHog project key | Existing upstream public event-ingestion identifier; Windows launcher disables telemetry by default |

Git ancestry checks confirmed that seven findings already exist in upstream
history. The remaining finding is the synthetic Windows test fixture. These
classifications do not rely on a blanket exclusion of tests or upstream files.

The release-specific text scan found no known credential prefixes, new private
key blocks or the previous personal locations. The tracked-file inspection found
no runtime databases, logs, user credential/configuration files, PFX/P12 files,
SSH private keys or real dotenv credentials. The dotenv example contains an
empty key variable only. The old private fork baseline is not an ancestor of
the public branch. The only added binary asset is the ZCode application icon;
copied font binaries and local mockup files are excluded.

This review found no personal or production credentials in the publication
inputs. Pattern scanning cannot prove the absence of every possible secret.
Public upstream test fixtures and public identifiers remain part of upstream
ancestry; they must never be repurposed as production credentials.

GitHub Actions are disabled for this preview so inherited upstream deployment,
mobile and npm-publication workflows do not run automatically. No repository
secrets, provider credentials or runtime data are configured on GitHub.
