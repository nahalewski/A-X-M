# API keys

Every key and service login A-X-M uses lives in `apis.json` in this folder.

`apis.json` is **gitignored and must stay that way** - this project's git remote is
public, and a key in a tracked file is a published key. Only `apis.example.json` is
committed.

    cp apis.example.json apis.json

Then fill in what you have. Anything left blank falls back to whatever is typed
into Settings, so nothing breaks if a key is missing here.

| Field                   | Used for                                  |
| ----------------------- | ----------------------------------------- |
| `steamGridDb`           | Box art and hero banners                  |
| `tmdb`                  | Film and TV metadata                      |
| `steamWeb`              | Steam library and achievements            |
| `retroAchievements`     | RetroAchievements                         |
| `retroAchievementsUser` | The username its API needs with the key   |
| `epg.url`               | TV Streaming portal address               |
| `epg.username`          | TV Streaming username                     |
| `epg.password`          | TV Streaming password                     |
| `epg.xmltvUrl`          | Separate XMLTV guide, if the provider has one |

The file is read at startup and never written by A-X-M, so it is safe to edit by
hand and to copy between machines.
