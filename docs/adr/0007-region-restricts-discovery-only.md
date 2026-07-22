# Region restriction applies only to public room discovery

Public Room Discovery returns `403` with `PUBLIC_ROOM_DISCOVERY_REGION_RESTRICTED` when the current request is identified as mainland China (`CN`), while unknown regions are allowed. This policy does not restrict direct room access, room creation, visibility changes, or chat, so a Mainland China Visitor may enter a known room and publish a Public Room even though they cannot browse the catalogue. Hong Kong, Macao, and Taiwan are outside the restriction, and the application makes no claim that the restriction is legally required.
