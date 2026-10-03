import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_ENDPOINTS } from '../config/api.config';
import { AntenasService } from './antenas.service';

describe('AntenasService', () => {
  it('lista antenas desde el endpoint protegido', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(AntenasService);
    const http = TestBed.inject(HttpTestingController);

    service.getAll().subscribe((antennas) => expect(antennas).toEqual([]));

    http.expectOne(API_ENDPOINTS.antenas).flush([]);
    http.verify();
  });
});
