# Chat messages take priority over discovery freshness

Room Activity is projected from each room's message store into the public discovery catalogue for sorting. Once a Chat Message has been accepted, failure to update that projection must not fail or roll back the message; the catalogue may temporarily rank the room using an older activity time and a later message may advance it. A durable retry pipeline was rejected for the first release because exact discovery ordering is less important than chat availability and does not justify another consistency mechanism.
