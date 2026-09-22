import React from 'react';
import {Composition} from 'remotion';
import {Film} from './Film';
import {FilmV3} from './FilmV3';
import {InvestorFilm} from './InvestorFilm';
export const Root:React.FC=()=> <>
 <Composition id="PoseTekDraftBV2" component={Film} durationInFrames={1650} fps={30} width={1080} height={1920}/>
 <Composition id="PoseTekCoachesV3" component={FilmV3} durationInFrames={1560} fps={30} width={1080} height={1920}/>
 <Composition id="PoseTekInvestorV1" component={InvestorFilm} durationInFrames={2700} fps={30} width={1920} height={1080}/>
</>;
