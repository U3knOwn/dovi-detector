// Copyright (c) 2026 Jamal2367
// Licensed under the MIT License. See LICENSE file in the project root for full license information.

/**
 * Quality ranking of HDR profiles, audio codecs and CM versions.
 *
 * Pure functions - they only look at the strings a scan produced, which is what
 * both the sorting and the statistics order by.
 */

export function getProfileRank(hdrFormat, hdrDetail, elType) {
    // Normalize strings
    const f = (hdrFormat || '').toLowerCase();
    const d = (hdrDetail || '').toLowerCase();
    const e = (elType || '').toLowerCase();

    // 0: Profile 7 FEL
    if ((d.includes('profile 7') || d.includes('prof 7') || d.includes('p7') || d.includes('profile7') || f.includes('dolby vision') || f.includes('dolby')) && e.includes('fel')) {
        return 0;
    }
    // 1: Profile 7 MEL
    if ((d.includes('profile 7') || d.includes('prof 7') || d.includes('p7') || d.includes('profile7') || f.includes('dolby vision') || f.includes('dolby')) && e.includes('mel')) {
        return 1;
    }
    // 2: Profile 8
    if (d.includes('profile 8') || d.includes('profile8') || d.includes('p8') || f.includes('profile 8') || f.includes('p8') ) {
        return 2;
    }
    // 3: Profile 5
    if (d.includes('profile 5') || d.includes('profile5') || d.includes('p5') ) {
        return 3;
    }
    // 4: HDR10+
    if (f.includes('hdr10+') || d.includes('hdr10+') || f.includes('hdr10plus') || d.includes('hdr10plus')) {
        return 4;
    }
    // 5: SL-HDR1 / SL-HDR2 / SL-HDR3
    if (f.includes('sl-hdr') || d.includes('sl-hdr')) {
        return 5;
    }
    // 6: HDR Vivid
    if (f.includes('vivid') || d.includes('vivid')) {
        return 6;
    }
    // 7: HDR (HDR10 or HLG)
    if (f.includes('hdr10') || d.includes('hdr10') || f.includes('hlg') || d.includes('hlg') || f.includes('smpte2084') || d.includes('smpte2084')) {
        return 7;
    }
    // 8: SDR
    if (f.includes('sdr') || d.includes('sdr')) {
        return 8;
    }
    // 9: fallback / unknown
    return 9;
}

export function getCmVersionRank(cmVersion) {
    // cmVersion may carry the DV structure, e.g. "CMv4.0 (ST-DL)" -> rank by version only
    const v = (cmVersion || '').toLowerCase().trim();
    if (v.startsWith('cmv4.0')) return 0;
    if (v.startsWith('cmv2.9')) return 1;
    return 2;
}

export function getCmStructureKey(cmVersion) {
    // Extract the structure abbreviation, e.g. "CMv4.0 (ST-DL)" -> "st-dl"
    const m = (cmVersion || '').toLowerCase().match(/\(([^)]+)\)/);
    return m ? m[1].trim() : '';
}

export function getAudioRank(audioCodec) {
    // Normalize audio codec string
    const audio = (audioCodec || '').toLowerCase();
    
    // Priority ranking based on audio quality/format
    // 0: Dolby TrueHD (Atmos)
    if (audio.includes('truehd') && audio.includes('atmos')) {
        return 0;
    }
    // 1: DTS:X
    if (audio.includes('dts:x') || audio.includes('dts-x') || audio.includes('dtsx')) {
        return 1;
    }
    // 2: Dolby TrueHD
    if (audio.includes('truehd')) {
        return 2;
    }
    // 3: DTS-HD MA
    if (audio.includes('dts-hd ma') || audio.includes('dts-hd master audio')) {
        return 3;
    }
    // 4: DTS-HD HRA
    if (audio.includes('dts-hd hra') || audio.includes('dts-hd high resolution')) {
        return 4;
    }
    // 5: Dolby Digital Plus (Atmos)
    if (audio.includes('digital plus') && audio.includes('atmos')) {
        return 5;
    }
    // 6: Dolby Digital Plus
    if (audio.includes('digital plus')) {
        return 6;
    }
    // 7: DTS (but not DTS-HD or DTS:X)
    if (audio.includes('dts') && !audio.includes('dts-hd') && !audio.includes('dts:x') && !audio.includes('dts-x') && !audio.includes('dtsx')) {
        return 7;
    }
    // 8: Dolby Digital (but not Plus)
    if ((audio.includes('dolby digital') || audio.includes('ac-3')) && !audio.includes('plus')) {
        return 8;
    }
    // 9+: Other formats (AAC, FLAC, MP3, PCM, etc.)
    return 9;
}

export function getChannelCount(audioCodec) {
    const audio = (audioCodec || '').toLowerCase();
    const channelMatch = audio.match(/\s(\d+\.\d+)(?=\s|$|\()/);

    if (channelMatch) {
        return parseFloat(channelMatch[1]);
    }

    return 0;
}

/* -------------------------------
   Sorting

   Every comparator describes the descending order of its mode and works on the
   keys prepareMediaItem() derived, so a sort is plain number and string
   comparison over an array - the table is re-rendered once at the end.
   ------------------------------- */
